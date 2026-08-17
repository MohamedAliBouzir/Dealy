# Vault — Phase 2 + 3

Vault is the secrets backbone from this point forward. Nothing generated
from Phase 3 onward (Keycloak client secrets, the app's DB credentials, JWT
signing keys, MinIO access keys) should ever be written to a plain `.env`
file — it goes in Vault.

## Topology & access

- Network: `app-net` only. No host-published port, ever. No reverse-proxy
  route either — `infra/nginx/nginx.conf` has no location block for it.
- The only access paths are `docker exec` (CLI) or a local port-forward
  over `docker exec`/an SSH tunnel if the UI is needed during setup. See
  `infra/README.md` for the live verification that confirms this (no host
  port, and every guessed path through the public HTTPS entrypoint 404s).
- Storage: integrated Raft (not the legacy `file` backend), single node
  today. Config: `infra/vault/config.hcl`.

## Unsealing after a restart — expected, not a bug

Vault has no auto-unseal configured (that requires a cloud KMS/HSM, out of
scope this phase — see the brief). Every container restart comes back
**sealed**, and the `vault` service's Docker healthcheck (`vault status`)
will correctly report `unhealthy` until it's unsealed — that's intentional,
so anything that later depends on Vault being ready won't race ahead of a
human unsealing it.

To unseal, run `vault operator unseal` three times (the deployment's
threshold), once per distinct key share, from wherever the shares are
stored:

```sh
docker exec dealy-vault-1 vault operator unseal <share A>
docker exec dealy-vault-1 vault operator unseal <share B>
docker exec dealy-vault-1 vault operator unseal <share C>
docker exec dealy-vault-1 vault status   # Sealed: false once done
```

The 5 unseal key shares and the initial root token were generated once,
during this phase's setup (`vault operator init -key-shares=5
-key-threshold=3`), displayed once directly to the human lead, and are not
stored anywhere in this repo, in any log, or in agent memory — by design.
Whoever is holding the shares is responsible for storing them separately
from one another (that's the entire point of a 3-of-5 threshold: no single
stored location is enough on its own).

> **Status (closed): the original Phase 2 root token was revoked by the
> human directly**, as the first step of Phase 3's setup (it was used once
> for `bootstrap.sh`, never revoked afterward, and separately appeared in
> full plaintext in the chat transcript twice — breaking the "shown once,
> never persisted" design regardless of file/log handling). Getting a
> working `keycloak-writer` policy + token took three ceremony rounds after
> that — two hit real bugs (rules 1 and 4 below), both fixed and now
> documented as standing procedure rather than left as one-off patches. The
> third round succeeded cleanly: `keycloak-writer` exists, its token is
> live and orphaned, and the ceremony's temporary root token was revoked
> and independently confirmed dead.

## Privileged Vault access: regenerate-on-demand, no standing admin identity

**Decision (locked, Phase 3): there is no persistent admin identity in
Vault.** No standing operator account, nothing left logged in between
sessions. Every time privileged work is needed — creating a policy,
enabling an auth method — root is regenerated from scratch via the
unseal-key holders' ceremony, used for exactly that task, then destroyed
again immediately. This is deliberately higher-friction than a standing
identity; the tradeoff is that root never exists at rest.

**This procedure is human-performed, interactively.** The agent does not
run any command that embeds the root token, an unseal key, or the
generate-root OTP as literal text — same boundary as the original
unseal/init handoff in Phase 2. What the agent *can* do afterward is run
follow-up commands that ride on a session the human already authenticated
inside the container (via `vault login`, so nothing about that session's
token is ever typed into an agent-run command) — mirroring how Phase 2's
KV v2/AppRole bootstrap worked once the human had unsealed and handed off.

The full procedure, repeated in full every time privileged access is
needed (Phase 3's `keycloak-writer` policy, Phase 4's own policy/AppRole
work, and beyond):

```sh
# 1. Start a new ceremony (produces a nonce and an OTP)
docker exec -it dealy-vault-1 vault operator generate-root -init

# 2. Once per key share, up to the threshold (3) — hidden-input prompt,
#    same pattern as unsealing. Run 3 times total, using -nonce=<nonce from step 1>.
docker exec -it dealy-vault-1 vault operator generate-root -nonce=<nonce>

# 3. Decode the result locally to get the usable temporary root token
docker exec -it dealy-vault-1 vault operator generate-root -decode=<encoded> -otp=<otp>

# 4. Log the temporary root token in *inside the container*, interactively —
#    the token is typed at a hidden prompt, never as a literal command
#    argument, and -no-print suppresses it being echoed back in the success
#    output. This persists a session file inside the container that
#    subsequent `docker exec ... vault ...` calls pick up automatically,
#    with no token ever appearing in an agent-run command.
docker exec -it dealy-vault-1 vault login -no-print
```

At that point the agent runs the secret-free configuration commands the
task needs against that persisted session — subject to the five rules
below, which apply to every future ceremony (Phase 4's own policy/AppRole
work included), not just this one:

**1. Never pass a file as a path argument to a `docker exec`'d Vault
command — pipe it via stdin instead.** A path argument like
`/tmp/policy.hcl` is subject to Git-Bash-on-Windows silently rewriting it
into a Windows path before `docker exec` ever sees it (the same class of
bug already worked around once with `MSYS_NO_PATHCONV=1` for the
self-signed-cert script and the gitleaks hook — and re-hit here because
that fix wasn't reapplied). Piping sidesteps the bug class entirely rather
than working around it with an environment variable:

```sh
cat infra/vault/policies/<name>.hcl | docker exec -i dealy-vault-1 vault policy write <name> -
```

**2. Verify each step independently before the next one runs — especially
before anything irreversible — don't rely on `set -e` alone.** A failing
`docker exec` doesn't reliably abort a chained script (observed directly:
a failed `vault policy write` didn't stop a script from reaching a `token
revoke -self` two steps later). Gate each step explicitly:

```sh
# after writing a policy — confirm it actually exists with the right content
docker exec dealy-vault-1 vault policy read <name> | grep -q '<expected path>' \
  || { echo "ABORT: policy verification failed"; exit 1; }

# after minting a token — confirm the file is non-empty before trusting it
docker exec dealy-vault-1 sh -c 'test -s /tmp/token.json' \
  || { echo "ABORT: token mint verification failed"; exit 1; }
```

Only once every prior step is independently confirmed does a revoke run.

**3. Never run a bare `vault token lookup` (or `-self`) if the output will
be shown or logged — it echoes the full token value back in its `id`
field, on success.** This isn't hypothetical: it happened once already,
during this phase's setup, checking whether a session was authenticated as
root. Use `vault token capabilities <some path>` instead for any
"is this session valid / what can it do" check — it reports the same kind
of information (or the same `permission denied / invalid token` failure
once a token is revoked) without ever including the token value in either
its success or failure output:

```sh
docker exec dealy-vault-1 vault token capabilities secret/data/keycloak/test
```

**4. Any token that needs to outlive the ceremony's root session must be
created with `-orphan` — otherwise revoking root kills it too.**
`vault token create` without `-orphan` makes the new token a *child* of
whatever session created it; Vault cascades revocation from parent to
child by default. Minting `keycloak-writer`'s working token from the
temporary root session, then revoking that root session, silently revoked
`keycloak-writer` along with it — discovered when `vault login` failed
with `permission denied / invalid token` on a token that had just been
successfully minted:

```sh
docker exec dealy-vault-1 sh -c "vault token create -orphan -policy=<name> -ttl=<ttl> -format=json > /tmp/token.json"
```

Before revoking root, use the new token's non-secret **accessor** (shown
via rule 3's pattern) to confirm it's both correctly scoped and marked
`orphan: true` — this check would have caught the bug above before the
irreversible revoke ran, rather than after:

```sh
docker exec dealy-vault-1 vault token lookup -accessor=<accessor>
```

`lookup -accessor=` is safe to run and display even though bare/`-self`
`lookup` (rule 3) is not — looking up a *different* token by its accessor
returns policies/ttl/orphan-status metadata without ever including that
token's `id` field, unlike a self-lookup.

Once the privileged work is done and the new token's independence is
confirmed:

```sh
# Revoke the temporary root token — it must not persist "just in case"
docker exec dealy-vault-1 vault token revoke -self

# Prove it, don't just trust the command's own output — this must now fail
docker exec dealy-vault-1 vault token capabilities secret/data/keycloak/test
```

**5. Any cleanup/delete step against a container path needs an explicit
existence-check afterward — `rm -f`'s silent success proves nothing.**
Unlike rule 1's other failure modes (which error loudly), a path-conversion
bug hitting `rm -f` doesn't error at all: it silently no-ops on the
mangled, nonexistent path and exits 0, indistinguishable from genuinely
having deleted the file. This let a short-lived token's plaintext sit at
rest in `/tmp` inside the container for the rest of a session — not
exposed anywhere, but longer-lived than intended, and discovered only by
chance via an unrelated `ls`:

```sh
docker exec dealy-vault-1 rm -f /tmp/token.json /tmp/token
docker exec dealy-vault-1 sh -c "ls /tmp/ 2>&1"   # confirm it's actually empty, don't trust rm's exit code
```

No root token exists at rest between ceremonies. This is the standard path
for any future privileged Vault change (new policies, new auth methods) —
Phase 4 uses it again for its own setup, and so on.

## Secrets engine: KV v2

Enabled at `secret/` (`vault secrets enable -path=secret kv-v2`).
Versioned, so credential rotation has history.

Path structure — all populated as of Phase 4:

| Path | Fields | Phase |
|---|---|---|
| `secret/keycloak/nestjs-api` | `client_id`, `client_secret` | 3 |
| `secret/keycloak/keycloak-admin-service` | `client_id`, `client_secret` | 3 |
| `secret/app-db/credentials` | `username`, `password`, `host`, `port`, `database`, `schema` | 4 |
| `secret/jwt/signing-key` | `algorithm=RS256`, `private_key`, `public_key` | 4 |
| `secret/minio/credentials` | `access_key`, `secret_key`, `endpoint`, `bucket` | 4 |
| `secret/redis/credentials` | `password`, `host`, `port` | 4 |

`app-db`, `minio`, and `jwt` hold dedicated, least-privilege credentials
generated specifically for the app (not the Postgres superuser or MinIO
root credentials, which stay in `.env` as infrastructure bootstrap
material — see `infra/README.md`). `redis` holds a copy of the same
password `.env` uses to start the Redis container — the app reads its copy
from here, not from `.env` directly.

## `keycloak-writer` policy (Phase 3 bootstrap only)

- Policy `keycloak-writer` (`infra/vault/policies/keycloak-writer.hcl`):
  `create`+`update`+`read` on `secret/data/keycloak/*` only. Same shape as
  `app-readonly` below — one path prefix, minimum verbs, nothing else.
- Not bound to a standing AppRole — this is a one-time provisioning script,
  not a persistent running service. It was granted to a short-lived token
  (`vault token create -policy=keycloak-writer -ttl=...`) issued from a
  temporary root session created via the regenerate-on-demand ceremony
  above, used only to write the Phase 3 client secrets, and left to expire
  naturally rather than kept around.

## AppRole auth (for the app, not the root token)

- Auth method: `approle`, enabled.
- Policy `app-readonly` (`infra/vault/policies/app-readonly.hcl`):
  read-only on `secret/data/app-db/*`, `secret/data/jwt/*`,
  `secret/data/minio/*`, `secret/data/redis/*` (added Phase 4).
  Deliberately excludes `secret/data/keycloak/*` — the app has no
  legitimate reason to read Keycloak's own credentials.
- Role `nestjs-app`, bound to `app-readonly`, `token_ttl=1h`,
  `token_max_ttl=4h`.

**`secret_id` generated (Phase 4).** `role_id` and `secret_id` are in
`infra/vault/approle/role_id` and `infra/vault/approle/secret_id` —
gitignored (the directory was added to `.gitignore` before either file was
created, not after), mounted read-only into the `nestjs-api` container.
Neither value is a literal anywhere in `.env`, `docker-compose.yml`, or
any committed file.

**TTL note — a real gotcha worth remembering:** the per-request override
field on `POST auth/approle/role/:role/secret-id` is named `ttl`, not
`secret_id_ttl` (that name is only valid inside the *role's own* config,
set once in Phase 2). Using the wrong field name silently succeeds with no
override applied — no error, easy to miss without checking. Separately,
even the correct field is capped by the `auth/approle` mount's
`max_lease_ttl`, which defaults to `768h` (32 days) and was never
explicitly widened here. The `secret_id` generated this phase has an
**effective TTL of 32 days**, not the 90 days originally intended —
confirmed via `expiration_time` on an accessor lookup, not assumed from
the request. If a longer lifetime is genuinely wanted later, that requires
deliberately tuning the mount (`vault auth tune -max-lease-ttl=<value>
approle`), a separate decision from generating the secret_id itself.

> **ACTION ITEM — dated, do not let this quietly disappear:** the current
> `secret_id` expires **~2026-09-17**. Accepted as-is (32 days, not
> extended) — but it *must* be regenerated via another regenerate-root
> ceremony before that date, or the app's AppRole re-authentication starts
> failing in production use. There is no auto-rotation in scope yet (no
> Vault Agent, no cron). Whoever picks this up next should either: (a) run
> the ceremony again close to the expiry date to mint a fresh `secret_id`
> and overwrite `infra/vault/approle/secret_id`, or (b) at that time,
> decide deliberately whether to widen the `auth/approle` mount's
> `max_lease_ttl` so future rotations can be less frequent — don't let (b)
> happen by default just because it's easier than doing (a) again. Also
> tracked in the `project-vault-phasing` memory.

This is not a standing AppRole/persistent-service pattern like
`keycloak-writer`'s token was for Phase 3 — `nestjs-app`'s `secret_id` *is*
the app's standing credential, meant to be read from its mounted file
every time the app authenticates, for the life of that file (until it
expires or is rotated).

The app authenticates with `vault write auth/approle/login
role_id=... secret_id=...` to get a short-lived token scoped to
`app-readonly`, reading both values from the mounted files — never typing
either as a literal argument.

## Reproducing this setup (`bootstrap.sh`)

`infra/vault/bootstrap.sh` is the idempotent part of this phase — it's what
actually ran to enable KV v2, write the policy, and create the AppRole.
Safe to re-run; it skips steps that are already done. It does **not**
initialize/unseal Vault (that's the one-time, human-witnessed step above)
and does **not** generate a Secret ID (Phase 4, as above).

```sh
docker cp infra dealy-vault-1:/tmp/infra
docker exec -e VAULT_ADDR=http://127.0.0.1:8200 -e VAULT_TOKEN=<a sufficiently-privileged token> -w /tmp dealy-vault-1 sh infra/vault/bootstrap.sh
docker exec dealy-vault-1 rm -rf /tmp/infra
```
