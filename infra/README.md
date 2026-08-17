# Infrastructure — Phase 1–4

Phases 1–3 were infra only. Phase 4 wires the NestJS app up to all of it —
plumbing and connectivity, still no business logic (auth guards, the
device-switch flow, etc. — that's Phase 5).

## Services

| Service | Purpose |
|---|---|
| `app-db` | Postgres dedicated to the app. `app_user` (least-privilege, Phase 4) owns the `app` schema — see [Prisma schema/migrations](#database-prisma) below. |
| `keycloak-db` | Postgres dedicated **solely** to Keycloak. Fully separate instance/volume from `app-db`, on its own isolated network — see "Why three data networks, not one" below. |
| `keycloak` | Identity/auth provider. Realm `dealy`, three clients — see [infra/keycloak/README.md](keycloak/README.md). |
| `redis` | Backing store for sessions, pub/sub, and future BullMQ job queues. |
| `minio` | S3-compatible object storage. Dedicated `dealy` bucket, scoped service-account credentials (Phase 4). |
| `vault` | Secrets backbone. No public exposure, ever — see [infra/vault/README.md](vault/README.md). |
| `nestjs-api` | The application itself (Phase 4). Connectivity to every service above, proven via `/health`. No auth guards or business logic yet. |
| `reverse-proxy` | nginx. The **only** service reachable from outside Docker. |

Not part of these phases (placeholders left in `docker-compose.yml` for
where they'll attach): Kafka/Zookeeper, coturn.

## Bringing the stack up locally

```sh
cp .env.example .env        # fill in real local values
./infra/nginx/generate-self-signed-cert.sh   # writes infra/nginx/certs/*.{crt,key} (gitignored)
docker compose up -d
docker compose ps            # everything should reach "healthy" — except vault
```

Reverse proxy: `https://localhost:8443` (self-signed cert — browser will
warn, that's expected for local dev). Keycloak sits behind it at `/`, admin
console at `/admin/`.

`vault` will show **unhealthy** on first boot (and after every restart) —
it comes up sealed by design and has no auto-unseal configured. That's
expected, not a fault; see [infra/vault/README.md](vault/README.md) to
unseal it. The other five services don't depend on Vault yet (nothing
reads secrets from it until Phase 3+), so a sealed Vault doesn't block the
rest of the stack from being usable.

Bring it down: `docker compose down` (add `-v` only if you intentionally
want to wipe the named volumes/data).

## Network topology

```
public-net  ── reverse-proxy only. Nothing else is internet-facing.
                    │
                    ▼ (reverse-proxy is the only bridge between the two)
app-net (internal)  ── reverse-proxy, keycloak, redis, vault. Not reachable
                        from public-net except through the proxy — and the
                        proxy has no route to vault (see below), so vault
                        is reachable from nothing outside app-net, period.
                    │
        ┌───────────┼───────────────┐
        ▼           ▼               ▼
data-net-appdb  data-net-keycloakdb  data-net-minio   (each internal:true,
   app-db          keycloak-db          minio           each fully isolated
                                                          from the others)
```

Only `reverse-proxy` publishes a host port (`HTTP_PORT`/`HTTPS_PORT` from
`.env`). Every other service is reachable only over the internal Docker
networks — `docker compose ps` shows no host-side port mapping for any of
them.

### Why three data networks, not one

The brief for this phase called for a single `data-net` holding `app-db`,
`keycloak-db`, and `minio`, with the constraint that `app-db` and
`keycloak-db` must never be able to reach each other. Those two requirements
conflict under plain Docker Compose: containers on the same bridge network
can reach each other by default — there's no built-in per-container firewall
between peers on one network. A shared `data-net` would make that "must
never reach each other" a documentation claim, not an enforced one.

So each datastore gets its own dedicated, `internal: true` network
(`data-net-appdb`, `data-net-keycloakdb`, `data-net-minio`). A service joins
only the network(s) for the datastore(s) it needs — `keycloak` joins
`data-net-keycloakdb`, and the future NestJS API will join `data-net-appdb`
and `data-net-minio`, but nothing ever joins both `data-net-appdb` and
`data-net-keycloakdb`. That makes the isolation structural: `app-db` and
`keycloak-db` are never on a network together, so there is no path between
them, full stop. `internal: true` additionally blocks all three from
reaching the public internet.

### Verifying the isolation

Run `docker compose up -d`, then:

```sh
# app-db can't even resolve keycloak-db or minio — different networks entirely
docker exec dealy-app-db-1 sh -c "getent hosts keycloak-db; getent hosts minio"

# reverse-proxy can't resolve either datastore — it's only on public-net + app-net
docker exec dealy-reverse-proxy-1 sh -c "getent hosts app-db; getent hosts keycloak-db"

# keycloak-db has no route to the internet at all (internal: true)
docker exec dealy-keycloak-db-1 sh -c "nc -zv -w3 8.8.8.8 443"

# no datastore has a host-published port
docker compose ps   # only reverse-proxy shows a PORTS column entry
```

All of the above were run against this exact compose file while writing it;
each command fails/returns empty as expected, confirming the boundaries are
real rather than asserted.

### Vault's exposure specifically

Vault sits on `app-net` (needed so it's reachable by keycloak/redis-adjacent
tooling and, later, the NestJS API) but has no host port and no
reverse-proxy route. Verified live, with the full stack running:

```sh
docker port dealy-vault-1                                  # → empty, no host port
curl -sk https://localhost:8443/v1/sys/health               # → 404 (nginx has no route to vault)
curl -sk https://localhost:8443/vault/                       # → 404
grep -i vault infra/nginx/nginx.conf                          # → no match
```

See [infra/vault/README.md](vault/README.md) for Vault's unseal workflow,
policy/path structure, and how later phases write real secrets into it.

## Keycloak admin console access

`infra/nginx/nginx.conf` restricts `/admin/` to an IP allowlist (loopback +
RFC1918 private ranges by default) and `deny all` beyond that — it fails
closed if nobody edits it. Replace the allowlist with your real admin
CIDR(s) or put a VPN in front before this leaves a dev machine. The rest of
Keycloak (`/`) stays reachable, since that's what end users authenticate
against.

## Secrets

- Real credentials live only in `.env` (gitignored). `.env.example` has
  placeholder values only.
- A pre-commit hook (`.husky/pre-commit`) runs `gitleaks` against staged
  changes; `.github/workflows/secret-scan.yml` runs it again in CI on every
  push/PR. Both block on detection.
- If GitHub-hosted, also turn on native secret scanning + push protection at
  the repo settings level — that's a dashboard setting, not something this
  repo's code can turn on for itself. **Manual step for the repo owner.**

## Vault: was deferred to Phase 2, now live (was a locked decision)

Phase 1 deliberately shipped without Vault — `.env` + `.gitignore` +
gitleaks (pre-commit and CI) was the full secrets story at that point,
because nothing genuinely sensitive existed yet (empty containers, no
schema, no Keycloak clients, no E2EE key material). That deferral was
explicitly scoped to *one* phase, not indefinite, with the constraint that
Vault had to land before Phase 3 (Keycloak realm/client config) generated
the first real secret.

Phase 2 delivered exactly that: Vault is now running (`app-net` only, no
public exposure — see above), initialized with a 5-share/3-threshold
Shamir split, KV v2 enabled at `secret/`, and an `approle` auth method +
least-privilege `app-readonly` policy in place for the app's future access.
See [infra/vault/README.md](vault/README.md) for the unseal workflow,
reserved path structure, and how Phase 3/4 write real secrets into it.

**From this point forward, no new secret should be written to `.env`.**
`.env` remains what it was in Phase 1 — local dev passwords for the
datastores — but anything Phase 3+ generates (Keycloak client secrets, the
app's real DB credentials, JWT signing keys, MinIO access keys) goes into
Vault, not a file.

## How the app sources its config and secrets (Phase 4)

**The `.env` split, stated plainly:** `.env` holds exactly two categories
of value now, and neither is what the running `nestjs-api` container reads
for its own secrets:
1. **Container bootstrap credentials** — `app-db`'s Postgres superuser,
   MinIO's root user, Redis's `--requirepass` value, Keycloak's admin
   login. These exist only because the *containers themselves* need them
   to start up; nothing about them is Vault's concern.
2. Everything else the app actually uses to talk to those services — the
   dedicated `app_user` Postgres role, the scoped MinIO service-account
   key, the JWT signing keypair, Keycloak's two client credential pairs,
   and Redis's own password (yes, the *same* password as bootstrap, but
   the app reads its copy from Vault, not from `.env` directly) — lives in
   Vault, fetched once at startup by `VaultService`
   (`src/vault/vault.service.ts`) and held in memory only.

**AppRole, not `.env`, is how the app authenticates to Vault in the first
place.** `role_id`/`secret_id` live in `infra/vault/approle/` (gitignored
before either file existed), mounted read-only into `nestjs-api` at
`/run/secrets/`. See [infra/vault/README.md](vault/README.md) for the
ceremony that generated them and the dated reminder about `secret_id`'s
expiry.

**Fail loud, verified live, not just by reading the code:** if Vault is
sealed or unreachable, or AppRole auth fails, `VaultService.onModuleInit`
throws, `main.ts` catches it and calls `process.exit(1)` — no fallback to
running without secrets. Confirmed with the actual production image: a
corrupted `secret_id` produces a clean non-zero exit and a log line
containing only a fixed safe message, never the bad value or a raw error
object (`node-vault` is built on axios, whose error `.config` includes
request headers — including the Vault token on any authenticated call —
which is exactly why nothing catches and logs a raw error anywhere in this
module).

**Prisma** (`src/prisma/prisma.service.ts`) connects as `app_user` using
Prisma 7's driver-adapter pattern (`@prisma/adapter-pg`), built from
discrete Vault-sourced fields (host/port/user/password/database), not a
connection-string URL — sidesteps URL-encoding entirely for whatever
characters a generated password happens to contain. Migrations
(`prisma/migrations/`) run separately via the Prisma CLI, authenticated
with the Postgres *superuser* for the one step that genuinely needs it
(shadow-database creation, which `app_user` deliberately can't do — that's
the least-privilege design working as intended, not a gap) and with
`app_user` for actually applying them. **Not automated — see "Running
migrations" below for why and how.**

### Running migrations — deliberately manual, not automated yet

Neither `migrate dev` nor `migrate deploy` runs anywhere in the container
startup path (`Dockerfile`'s `CMD` is exactly `node dist/main`). This is a
**decision, not a gap**: the schema includes the single-active-device
partial unique index — a real database-level guarantee with no
first-class Prisma syntax, applied via hand-edited SQL (see the migration
file). The call is to have a human watch that specific migration run a
few more times, deliberately, before it's ever allowed to happen
unattended. Automating it now would mean the first few times this
exact schema change (or ones like it, touching the same constraint) gets
applied for real, nobody's actually watching it happen. Revisit this once
there's enough confidence in the process — not on a fixed timeline, on
demonstrated repetition.

**Standard procedure, until that changes** (this is exactly what was run
to create and apply the current migration):

1. **Bring up an intermediate build-stage image** — has the Prisma CLI
   (a devDependency, not in the production image) and the compiled
   source, without needing a fresh `npm ci` on every run:
   ```sh
   docker build --target build -t dealy-app-build-stage .
   ```
2. **Start a long-lived runner container**, attached to both networks it
   needs — `data-net-appdb` (to reach `app-db`) and `app-net` (to reach
   `vault`) — with the local `prisma/` directory mounted read-write so
   generated migration files land directly on the host, and the AppRole
   credentials mounted read-only:
   ```sh
   docker run -d --name prisma-runner \
     --network dealy_data-net-appdb \
     -v "$(pwd)/prisma:/app/prisma" \
     -v "$(pwd)/infra/vault/approle:/run/secrets:ro" \
     -w /app dealy-app-build-stage sleep 3600
   docker network connect dealy_app-net prisma-runner
   ```
3. **For a new migration**: fetch the Postgres *superuser* password from
   `.env` (needed only for this one step — shadow-database creation,
   which `app_user` deliberately can't do), build a `DATABASE_URL` from it
   piped via stdin (never a literal argument), and generate without
   applying:
   ```sh
   docker exec prisma-runner sh -c 'DATABASE_URL=$(cat /tmp/db_url_super) npx prisma migrate dev --name <name> --create-only'
   ```
   Hand-edit the generated SQL for anything Prisma's schema syntax can't
   express (partial indexes, etc.) **before** applying it.
4. **To apply**: fetch `app_user`'s credentials from Vault via the
   mounted AppRole (the same non-privileged read pattern the app itself
   uses — no ceremony needed, this is exactly what `app-readonly` is
   scoped for), build its `DATABASE_URL`, and run:
   ```sh
   docker exec prisma-runner sh -c 'DATABASE_URL=$(cat /tmp/db_url_appuser) npx prisma migrate deploy'
   ```
5. **Verify the result directly against the database**, not just the
   command's exit code — check the tables/indexes exist with `psql`, and
   for anything expressing a real constraint (like the partial unique
   index), attempt the actual violation and confirm the database rejects
   it. See the migration file's own comment for how that was done here.
6. **Clean up**: `docker rm -f prisma-runner`, remove the build-stage
   image if it's not needed again soon.

If this ever does get automated, the design already accounts for it:
`app_user` applying migrations via `migrate deploy` needs no privilege
beyond what it already has (it owns the `app` schema); only *generating*
a migration needs the superuser, which is itself a one-time,
human-performed step per schema change, not a startup-time operation.

**`app-db` and `keycloak-db` both override `pg_hba.conf`**
(`infra/postgres/pg_hba.conf`, mounted read-only, `command: postgres -c
hba_file=...`) to require `scram-sha-256` on every connection method,
including Unix socket and loopback. The stock `postgres:16-alpine` image's
*default* `pg_hba.conf` uses `trust` for local/loopback connections —
meaning anything connecting via `-h localhost` or a bare Unix socket
authenticates as any role with **no password check at all**. This was
discovered the hard way during Phase 4: several password-rotation
"verification" commands run against `localhost` reported success without
ever actually checking the password, because `trust` doesn't check it —
only a genuine cross-container connection over the real network
(`-h app-db`, matching what the app and Prisma migrations actually use)
exercises real authentication. Verified live: `pg_isready` (the
healthcheck) doesn't need `trust` to work; unauthenticated `localhost`/socket
connections now fail with `fe_sendauth: no password supplied`.

**A structural gotcha worth remembering if this module gets touched
again:** every service that depends on `VaultService` (Prisma, Redis,
MinIO) builds its real client in its own `onModuleInit`, not its
constructor. `VaultService` only populates its secrets in *its*
`onModuleInit` — which Nest's lifecycle guarantees runs before a
dependent's `onModuleInit`, but constructors for *all* providers run
before *any* `onModuleInit` fires. Reading Vault secrets in a constructor
crashes at startup ("Cannot destructure property 'x' of ... undefined"),
found live on the first real smoke test of each module, not by reading
the code.

**Keycloak connectivity has a similar hostname gotcha:** `KC_HOSTNAME` is
set to `localhost` for browser-facing access through the reverse proxy,
which means Keycloak's own discovery document advertises `jwks_uri` (and
`issuer`) as `http://localhost:8080/...` — correct for a browser, wrong
for `nestjs-api`, where "localhost" means itself. `KeycloakService`
deliberately does not follow the discovery document's self-reported
`jwks_uri`; it builds the JWKS URL from the same known-good internal
`KEYCLOAK_URL` used for the discovery fetch itself (the JWKS path is a
fixed, standard OIDC endpoint, not something that varies).

> **ACTION ITEM for Phase 5 — this fix does not cover `issuer`.** The fix
> above is scoped to the JWKS URL only, used for the health check's own
> internal fetch. `issuer` (and `authorization_endpoint`/`token_endpoint`,
> not currently read anywhere in this codebase) are **not** touched by
> it, and confirmed live to also read `http://localhost:8080/realms/dealy`
> — the exact same value Keycloak embeds as the `iss` claim in every real
> signed token, not just in the discovery document. This is *expected*
> OIDC behavior (issuer is a logical identity string to validate against,
> not a URL meant to be dereferenced the way `jwks_uri` is) — but it means
> whatever token-validation code Phase 5 builds must compare the `iss`
> claim against the **external** (`KC_HOSTNAME`-based) value, not the
> internal `KEYCLOAK_URL` (`http://keycloak:8080`) used everywhere else in
> this codebase for backend connectivity — those two are different values
> today, confirmed live, and nothing currently captures the external one
> anywhere. Don't let the internal `KEYCLOAK_URL` get reused by mistake as
> the expected-issuer value when that code gets written.

**`/health`** (`GET /health`, via `@nestjs/terminus`) reports live status
for all five: `vault`, `keycloak`, `database`, `redis`, `minio`. Verified
against the real stack — full JSON:
```json
{"status":"ok","info":{"vault":{"status":"up"},"keycloak":{"status":"up"},"database":{"status":"up"},"redis":{"status":"up"},"minio":{"status":"up"}},"error":{},"details":{...}}
```
