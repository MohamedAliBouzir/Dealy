#!/usr/bin/env sh
# Idempotent Vault configuration: KV v2 engine + least-privilege policy +
# AppRole auth method for the future NestJS API.
#
# Does NOT initialize or unseal Vault (that's a one-time, human-witnessed
# step — see infra/vault/README.md) and does NOT generate an AppRole
# Secret ID (that's a Phase 4 action once the app container exists).
#
# Requires VAULT_ADDR and VAULT_TOKEN (a token with sufficient privileges,
# e.g. the root token during initial setup) in the environment.

set -e

vault secrets list -format=json | grep -q '"secret/"' \
  && echo "secret/ KV v2 already enabled, skipping" \
  || vault secrets enable -path=secret kv-v2

vault policy write app-readonly infra/vault/policies/app-readonly.hcl

vault auth list -format=json | grep -q '"approle/"' \
  && echo "approle auth already enabled, skipping" \
  || vault auth enable approle

vault write auth/approle/role/nestjs-app \
  token_policies="app-readonly" \
  token_ttl=1h \
  token_max_ttl=4h \
  secret_id_ttl=0

echo "Vault bootstrap complete: KV v2 at secret/, approle role 'nestjs-app' bound to policy 'app-readonly'."
