# Infrastructure — Phase 1 + 2

This is infra only: containers, network topology, secrets discipline. No
application code runs inside any of these services yet.

## Services

| Service | Purpose |
|---|---|
| `app-db` | Postgres dedicated to the future NestJS app. Empty — no schema yet. |
| `keycloak-db` | Postgres dedicated **solely** to Keycloak. Fully separate instance/volume from `app-db`, on its own isolated network — see "Why three data networks, not one" below. |
| `keycloak` | Identity/auth provider. No realm/client/role config yet — see [infra/keycloak/README.md](keycloak/README.md). |
| `redis` | Backing store for sessions, pub/sub, and future BullMQ job queues. |
| `minio` | S3-compatible object storage for future media/image handling. |
| `vault` | Secrets backbone (Phase 2). No public exposure, ever — see [infra/vault/README.md](vault/README.md). |
| `reverse-proxy` | nginx. The **only** service reachable from outside Docker. |

Not part of these phases (placeholders left in `docker-compose.yml` for
where they'll attach): the NestJS API container, Kafka/Zookeeper, coturn.

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
