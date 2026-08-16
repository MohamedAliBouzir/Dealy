# Keycloak realm config — reserved for a later phase

This phase stands up the `keycloak` container against its own `keycloak-db`
and confirms it's reachable only through the reverse proxy. It does **not**
define any realm, client, role, or scope — that's application-level identity
design, not infrastructure, and belongs to the next phase.

When a realm export lands here for reproducibility, verify before committing:

- All `secret` fields (client secrets, SMTP credentials, etc.) are stripped
  or replaced with a `${PLACEHOLDER}` — Keycloak's realm export embeds live
  secrets by default.
- The file has been diffed specifically for anything that looks like a
  credential, not just skimmed.
