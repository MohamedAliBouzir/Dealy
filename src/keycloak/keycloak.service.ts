import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VaultService } from '../vault/vault.service';

interface OidcDiscoveryDocument {
  jwks_uri: string;
  issuer: string;
}

/**
 * Connection/wiring only — this phase proves the app can reach Keycloak's
 * OIDC discovery document and JWKS endpoint. It does not validate any real
 * user token and attaches no guards; that's Phase 5.
 */
@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly realmUrl: string;
  private discoveryDocument: OidcDiscoveryDocument | undefined;

  constructor(
    private readonly config: ConfigService,
    // Pulled from Vault to confirm the app's own OIDC client credentials
    // (and the admin-service ones, for Phase 5) are wired and available —
    // not used for the discovery/JWKS calls below, which are unauthenticated
    // by design in OIDC.
    private readonly vault: VaultService,
  ) {
    const baseUrl = this.config.getOrThrow<string>('KEYCLOAK_URL');
    const realm = this.config.getOrThrow<string>('KEYCLOAK_REALM');
    this.realmUrl = `${baseUrl}/realms/${realm}`;
  }

  /** Confirms both credential pairs are actually readable from Vault. */
  confirmClientCredentialsConfigured(): boolean {
    const api = this.vault.getKeycloakApiSecrets();
    const adminService = this.vault.getKeycloakAdminServiceSecrets();
    return Boolean(
      api.clientId &&
      api.clientSecret &&
      adminService.clientId &&
      adminService.clientSecret,
    );
  }

  /**
   * Live reachability check for the health endpoint: fetches (and caches)
   * the discovery document if needed, then confirms the JWKS endpoint
   * responds with a key set. Never throws — returns false on any failure,
   * since Keycloak being briefly unreachable shouldn't crash the app the
   * way a Vault failure does.
   */
  async checkHealth(): Promise<boolean> {
    try {
      if (!this.discoveryDocument) {
        this.discoveryDocument = await this.fetchDiscoveryDocument();
      }

      // Deliberately NOT fetching this.discoveryDocument.jwks_uri as-is:
      // Keycloak's KC_HOSTNAME is set for the browser-facing reverse-proxy
      // address, so every URL in the discovery document — issuer, jwks_uri,
      // everything — advertises that external hostname, not the internal
      // Docker network address other containers need. From inside this
      // container, following jwks_uri literally means "myself", not
      // Keycloak — confirmed live (it 404s/refuses). The JWKS path itself
      // is a fixed, standard OIDC endpoint, so it's built from the same
      // known-good internal base URL used for the discovery fetch instead.
      const jwksUrl = `${this.realmUrl}/protocol/openid-connect/certs`;
      const jwksResponse = await fetch(jwksUrl);
      if (!jwksResponse.ok) {
        return false;
      }
      const jwks = (await jwksResponse.json()) as { keys?: unknown[] };
      return Array.isArray(jwks.keys);
    } catch {
      this.logger.warn('Keycloak connectivity check failed.');
      this.discoveryDocument = undefined;
      return false;
    }
  }

  private async fetchDiscoveryDocument(): Promise<OidcDiscoveryDocument> {
    const response = await fetch(
      `${this.realmUrl}/.well-known/openid-configuration`,
    );
    if (!response.ok) {
      throw new Error(`discovery document fetch failed: ${response.status}`);
    }
    return (await response.json()) as OidcDiscoveryDocument;
  }
}
