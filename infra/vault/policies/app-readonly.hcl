# Least-privilege policy for the future NestJS API's AppRole.
# Read-only, and only on the paths the app has a legitimate reason to read.
# Notably excludes secret/data/keycloak/* — the app has no business reading
# Keycloak's own admin/client credentials.

path "secret/data/app-db/*" {
  capabilities = ["read"]
}

path "secret/data/jwt/*" {
  capabilities = ["read"]
}

path "secret/data/minio/*" {
  capabilities = ["read"]
}
