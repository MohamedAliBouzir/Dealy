# Security Policy

This project is open source and licensed under **AGPL-3.0**. Being public is a
deliberate choice, not an oversight — per Kerckhoffs's principle, our security
does not depend on secrecy of design, only on the secrecy of keys and
credentials, none of which ever live in this repository. See
`docs/architecture/encryption.md` for the full end-to-end encryption design.

If you're looking for how we handle secrets in this codebase, see
`docs/architecture/secrets-management.md`. If you believe a secret has leaked
into this repo despite our safeguards, treat it as a vulnerability report
(below) — do not open a public issue.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ |
| Older tagged releases | ❌ (upgrade to latest) |

This project is under active development. Until we cut a `v1.0.0`, only
`main` receives security fixes.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**
A public issue discloses the flaw to potential attackers before we've had a
chance to patch it.

Instead, report privately via:

- **Email:** security@[domain-tbd] (PGP key below)
- **GitHub Private Vulnerability Reporting:** use the "Report a vulnerability"
  tab under this repo's Security section, if enabled.

Please include:

1. A clear description of the vulnerability and its potential impact
2. Steps to reproduce (or a proof-of-concept, if applicable)
3. Any relevant logs, screenshots, or code references
4. Whether you believe it affects confidentiality, integrity, or availability

### What to expect

- **Acknowledgment within 72 hours** of your report.
- **Initial assessment within 7 days** — severity classification and whether
  it's accepted, and a rough remediation timeline.
- **Coordinated disclosure** — we ask that you give us reasonable time to
  patch before any public disclosure. We'll agree on a disclosure date
  together once a fix is ready. We do not impose an arbitrary embargo beyond
  what's needed to ship and roll out a fix.
- **Credit** — with your permission, we'll credit you in the release notes /
  a `CREDITS.md` once the fix ships.

### Safe Harbor

We will not pursue legal action against researchers who:

- Act in good faith to identify and report a vulnerability
- Avoid privacy violations, data destruction, or service disruption during
  testing
- Do not access, modify, or exfiltrate data belonging to other users
- Give us reasonable time to remediate before public disclosure

Given this app's E2EE design, please note: attempting to access plaintext
message content you are not a legitimate party to (e.g. via a compromised
server, DB access, or backup) is explicitly in-scope as a critical
vulnerability report — it should never be possible by design, and if you
found a way, we want to know immediately.

## Scope

**In scope:**
- The NestJS backend (auth, GraphQL/REST API, socket gateway, purge logic)
- The device-switch / grace-period / device-fingerprint enforcement logic
- The E2EE implementation (key exchange, ratchet, ciphertext handling)
- Keycloak realm configuration and integration
- Docker/infra configuration in this repo (docker-compose, reverse proxy
  config, network segmentation)
- Any client application in this repo (web/mobile/desktop) once published

**Out of scope:**
- Third-party dependencies with their own disclosure process (report
  upstream; let us know too so we can track it)
- Denial-of-service via brute-force volume alone (report if you find a way
  to bypass our rate limiting itself — that's in scope)
- Social engineering against maintainers or users
- Physical attacks against infrastructure we don't control (self-hosted
  deployments by third parties)

## A Note on Our Threat Model

This project treats the **server operator as untrusted by design** — the
entire point of true E2EE is that even a fully compromised backend, database,
or malicious admin should never yield plaintext message content. If you find
a path from server/DB access to plaintext, that is our highest-severity class
of bug, full stop, regardless of how difficult it was to reach.

Vulnerabilities in the **authentication and device-switch layer** (session
hijacking, bypassing the grace-period confirmation, forging a device
fingerprint, triggering an unauthorized purge) are treated as **critical**,
since in this architecture, unauthorized device-switch approval doesn't just
leak data — it destroys it.

---

Thank you for helping keep this project and its users safe.