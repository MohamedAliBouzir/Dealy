ui = true

listener "tcp" {
  address     = "0.0.0.0:8200"
  # Internal-only: this listener is never reachable outside app-net (no host
  # port, no reverse-proxy route — see infra/README.md). TLS is disabled here
  # for that reason; re-enable it (or add mTLS) if Vault ever spans multiple
  # hosts instead of a single Docker network.
  tls_disable = true
}

storage "raft" {
  path    = "/vault/data"
  node_id = "vault-1"
}

api_addr     = "http://vault:8200"
cluster_addr = "http://vault:8201"

# Single node today. Adding a peer later only means adding another
# `storage "raft"` node with `retry_join` pointed at this one — the storage
# backend itself doesn't change.
