# Vault — Phase 2

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

**Root token usage should be minimal from here on — revoke it the moment
bootstrap is done, don't just set it aside.** It was needed once to run
`bootstrap.sh` (enable the KV engine, write the policy, create the
AppRole). As soon as that finishes:

```sh
docker exec -e VAULT_TOKEN=<root token> dealy-vault-1 vault token revoke -self
```

This does not lock you out permanently — a new root token can always be
minted later via `vault operator generate-root`, which is authorized using
the unseal key shares (a challenge-response flow), not the old token. That
mechanism is the intended way to regain root access if it's ever genuinely
needed again; keeping the original root token alive "just in case" instead
is the thing to avoid.

> **Status as of this phase's setup (2026-08-16): treat this token as
> compromised, not merely un-revoked.** The root token generated during
> `vault operator init` was used to run `bootstrap.sh` and never revoked —
> and separately, it appeared in full plaintext in the chat transcript
> twice (the original one-time reveal, and again in a later recap). A chat
> transcript is a durable record, so the "shown once, never persisted"
> design goal was already broken independent of whether it was ever written
> to a file. This is not a queued cleanup item — it is the **first command
> run, before anything else**, the next time this Vault is unsealed. Delete
> this status note only after that revoke has actually happened.

## Secrets engine: KV v2

Enabled at `secret/` (`vault secrets enable -path=secret kv-v2`).
Versioned, so credential rotation has history.

Reserved path structure — **documented here, not populated in Vault**.
Nothing gets written to these paths until the phase that actually needs the
value exists:

```
secret/keycloak/     client secrets, admin credentials     — Phase 3
secret/app-db/       NestJS Postgres credentials            — Phase 4
secret/jwt/          signing keys                           — Phase 4
secret/minio/        access/secret keys                     — Phase 4
```

## AppRole auth (for the app, not the root token)

- Auth method: `approle`, enabled.
- Policy `app-readonly` (`infra/vault/policies/app-readonly.hcl`):
  read-only on `secret/data/app-db/*`, `secret/data/jwt/*`,
  `secret/data/minio/*`. Deliberately excludes `secret/data/keycloak/*` —
  the app has no legitimate reason to read Keycloak's own credentials.
- Role `nestjs-app`, bound to `app-readonly`, `token_ttl=1h`,
  `token_max_ttl=4h`.

**No Secret ID has been generated.** That's a Phase 4 action, once the
NestJS API container actually exists and needs to authenticate. When that
phase arrives, bootstrapping the app's access looks like:

```sh
# Role ID — not itself secret, safe to store as ordinary config (akin to a client_id)
vault read auth/approle/role/nestjs-app/role-id

# Secret ID — IS secret (akin to a client_secret). Generate it only when the
# app is ready to consume it, and hand it to the app the same way the root
# token was handled here: once, directly, never written to a repo file.
vault write -f auth/approle/role/nestjs-app/secret-id
```

The app then authenticates with `vault write auth/approle/login
role_id=... secret_id=...` to get a short-lived token scoped to
`app-readonly`.

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
