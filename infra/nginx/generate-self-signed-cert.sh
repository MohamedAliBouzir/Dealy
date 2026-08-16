#!/usr/bin/env sh
# Generates a local-dev self-signed TLS cert for the reverse proxy.
# Output is gitignored (infra/nginx/certs/*) — never commit real certs/keys.
set -e

# Prevents Git-Bash-on-Windows from rewriting "/CN=localhost" into a filesystem path.
export MSYS_NO_PATHCONV=1

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$CERT_DIR/selfsigned.key" \
  -out "$CERT_DIR/selfsigned.crt" \
  -days 365 \
  -subj "/CN=localhost"

echo "Wrote $CERT_DIR/selfsigned.crt and $CERT_DIR/selfsigned.key"
