# Narrow, single-purpose policy for the one-time Phase 3 Keycloak bootstrap.
# Write (create+update) and read, on secret/data/keycloak/* only — nothing
# else. Mirrors the shape of app-readonly: one path prefix, minimum verbs.
# Bound to a short-lived token for this phase's writes, not a standing
# AppRole — this is one-off provisioning, not a persistent service.

path "secret/data/keycloak/*" {
  capabilities = ["create", "update", "read"]
}
