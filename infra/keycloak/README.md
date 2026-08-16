# Keycloak — Phase 3

The `keycloak` container (Phase 1) now has a real realm, clients, and auth
policy configured (Phase 3). No NestJS integration, no token validation
code, no frontend onboarding UX yet — that's Phase 4+.

## Realm: `dealy`

Not `master` — `master` stays limited to Keycloak's own internal admin,
per the Phase 1 boundary. No application user or client lives there.

- **Password policy:** 12+ characters, upper+lower+digit+special char
  required, can't contain the username or email, last 3 passwords can't be
  reused, 600,000 PBKDF2 hash iterations.
  - **Known gap:** Keycloak has no native "reject common/breached
    passwords" check (no built-in HaveIBeenPwned-style provider). This was
    asked for explicitly and isn't implemented — it would need a custom
    SPI, out of scope for this phase. Flagging it here rather than
    silently skipping it.
- **Brute-force detection:** on, temporary lockout (not permanent) after 5
  failed attempts, wait time increases per failure up to 15 minutes,
  failure count resets after 12 hours of no attempts.
- **Token/session lifetimes** (explicitly set, not Keycloak's defaults —
  confirmed values, see the Phase 3 brief):
  | Setting | Value |
  |---|---|
  | Access token lifespan | 60 minutes |
  | Refresh token rotation | On — old refresh token invalidated on use (`revokeRefreshToken=true`, `refreshTokenMaxReuse=0`) |
  | SSO session idle | 24 hours |
  | SSO session max | 30 days |

  These are a secondary bound, not the primary enforcement mechanism —
  single-active-device is actually enforced by the backend's own
  device-switch logic (force-logout via `keycloak-admin-service`, below).
  Relaxing these numbers doesn't weaken that guarantee.

## Clients

| Client | Type | Purpose |
|---|---|---|
| `app-client` | Public, PKCE-only (`pkce.code.challenge.method=S256`) | Web/mobile/desktop frontends authenticate here. No client secret — public clients don't get one. |
| `nestjs-api` | Confidential, no browser flows, no service account | Backend validates/introspects tokens using this client's secret. |
| `keycloak-admin-service` | Confidential, service account enabled | Used by the backend's `DeviceSwitchModule` to force-revoke a user's Keycloak session during the device-switch flow. |

All three: Direct Access Grants (ROPC) and Implicit Flow are **disabled**.
PKCE covers the frontend's auth needs; there's no reason to allow either.

`keycloak-admin-service`'s service account holds exactly **one**
realm-management role: `manage-users`. That's the narrowest built-in role
that permits forcing a user's session logout via the Admin REST API
(`POST /admin/realms/{realm}/users/{id}/logout`) — Keycloak doesn't ship a
more granular "logout-only" role. `manage-users` is broader than ideal (it
also permits general user management, not just logout); a truly
minimal-scope role would need a custom authorization setup, out of scope
here. Worth revisiting if this client's blast radius ever matters more
than it does today.

**Redirect URIs are placeholders** — no real frontend exists yet:
- `app-client`: `http://localhost:3001/*` and web origin `http://localhost:3001`

Both need real values once frontend origins exist. Don't assume these are
production-ready.

## MFA

- **TOTP:** available, not required at registration (`CONFIGURE_TOTP`:
  `enabled: true, defaultAction: false`) — this was already Keycloak's
  default for a fresh realm, not something this phase had to turn on.
  Matches the earlier decision: strongly recommended, not enforced.
- **WebAuthn/FIDO2:** available as an optional authenticator
  (`webauthn-register`, `webauthn-register-passwordless`: same
  enabled-not-default state), also a pre-existing default.
- **SMS:** not configured, and nothing needed to explicitly disable it —
  no SMS provider integration exists in a default Keycloak install.
  Excluded due to SIM-swap risk, per the earlier decision.
- Building onboarding UI that nudges users toward enabling TOTP is a
  frontend concern for a later phase. This phase only makes the
  authenticators available in the realm.

## Where the secrets actually live

Client secrets for `nestjs-api` and `keycloak-admin-service` were fetched
from Keycloak and written directly into Vault — **paths only below, never
values**:

```
secret/keycloak/nestjs-api              → client_id, client_secret
secret/keycloak/keycloak-admin-service  → client_id, client_secret
```

Written using the `keycloak-writer` Vault token (see
`infra/vault/README.md`), piped directly between the `keycloak` and
`vault` containers — the secret values were never typed as a literal
command argument and never appeared in any visible output at any point in
that process. `app-client` is public and has no secret to store.

> **TODO (Phase 4, named item — do not let this quietly disappear):**
> Keycloak's own admin bootstrap credential (`KEYCLOAK_ADMIN_USER`/
> `KEYCLOAK_ADMIN_PASSWORD`) is still in `.env`, not Vault. It predates
> Vault and wasn't generated by this phase — it's a formal deferred
> decision, not an oversight. Resolve explicitly in Phase 4: either move it
> into Vault (which raises its own bootstrapping question — how Keycloak's
> container gets it injected at boot without landing back in `.env`) or
> make a deliberate call that it stays as infrastructure bootstrap
> material, a different category from application/client secrets. Don't
> act on this without asking first. Also tracked in the `project-vault-phasing`
> memory so it isn't lost even if this file isn't re-read.

## Realm export: deliberately not done this phase

Redirect URIs are still placeholders and the realm isn't close to final —
exporting now would just mean re-exporting (and re-verifying secrets are
stripped) again shortly after. Revisit once the realm is closer to
production shape. When it does happen, the verification requirement from
Phase 1 still applies: check the export file yourself for anything
secret-shaped before it touches the repo — Keycloak's export embeds live
secrets by default depending on export options used, don't assume the tool
handled it correctly.
