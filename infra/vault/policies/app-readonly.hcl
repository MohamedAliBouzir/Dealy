# Least-privilege policy for the future NestJS API's AppRole.
# Read-only, and only on the paths the app has a legitimate reason to read.

path "secret/data/app-db/*" {
  capabilities = ["read"]
}

path "secret/data/jwt/*" {
  capabilities = ["read"]
}

path "secret/data/minio/*" {
  capabilities = ["read"]
}

path "secret/data/redis/*" {
  capabilities = ["read"]
}

# Explicit paths, not a secret/data/keycloak/* wildcard — the app needs its
# own OIDC client credentials (nestjs-api) to talk to Keycloak at all, and
# the admin-service credentials are configured here in Phase 4 for Phase
# 5's device-switch force-logout capability (not used yet). Enumerating
# both by name means a future, unrelated Keycloak secret landing under
# this prefix isn't automatically readable by the app.
path "secret/data/keycloak/nestjs-api" {
  capabilities = ["read"]
}

path "secret/data/keycloak/keycloak-admin-service" {
  capabilities = ["read"]
}
