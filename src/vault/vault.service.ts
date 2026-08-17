import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import NodeVault from 'node-vault';
import type {
  AppDbSecrets,
  JwtSecrets,
  KeycloakClientSecrets,
  MinioSecrets,
  RedisSecrets,
} from './vault.types';

interface ApproleLoginResponse {
  auth: { client_token: string };
}

interface KvReadResponse {
  data?: { data?: Record<string, string> };
}

/**
 * Fetches every secret the app needs from Vault once at startup and holds
 * them in memory for the rest of the process's lifetime. Never persists a
 * secret back to disk, never logs one. If Vault is unreachable or AppRole
 * auth fails, onModuleInit throws — Nest's bootstrap then rejects and the
 * process must be allowed to exit non-zero (see main.ts), never fall back
 * to running without secrets.
 */
@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private client: NodeVault.client;

  private appDb!: AppDbSecrets;
  private jwt!: JwtSecrets;
  private minio!: MinioSecrets;
  private redis!: RedisSecrets;
  private keycloakApi!: KeycloakClientSecrets;
  private keycloakAdminService!: KeycloakClientSecrets;

  constructor(private readonly config: ConfigService) {
    this.client = NodeVault({
      apiVersion: 'v1',
      endpoint: this.config.getOrThrow<string>('VAULT_ADDR'),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.authenticate();
    await this.loadSecrets();
    this.logger.log('Vault secrets loaded successfully.');
  }

  private async authenticate(): Promise<void> {
    const roleIdFile = this.config.getOrThrow<string>('VAULT_ROLE_ID_FILE');
    const secretIdFile = this.config.getOrThrow<string>('VAULT_SECRET_ID_FILE');

    let roleId: string;
    let secretId: string;
    try {
      roleId = (await readFile(roleIdFile, 'utf-8')).trim();
      secretId = (await readFile(secretIdFile, 'utf-8')).trim();
    } catch {
      // Never log the caught error itself — a file-read failure's message
      // could echo back the configured path, which is fine, but there is
      // no upside to risking more than that being surfaced.
      throw new Error(
        'Vault AppRole credentials could not be read from the mounted files.',
      );
    }

    if (!roleId || !secretId) {
      throw new Error('Vault AppRole role_id/secret_id file was empty.');
    }

    try {
      const result = (await this.client.approleLogin({
        role_id: roleId,
        secret_id: secretId,
      })) as ApproleLoginResponse;
      this.client.token = result.auth.client_token;
    } catch {
      // Deliberately not logging the caught error: node-vault is built on
      // axios, and an axios error's `config` includes request headers —
      // which, on any subsequent authenticated call, would include the
      // Vault token. Only ever surface a fixed, safe message here.
      throw new Error(
        'Vault AppRole authentication failed — check role_id/secret_id and Vault connectivity.',
      );
    } finally {
      // These only ever held local credential material, not the session
      // token — clear the references now that login has been attempted.
      roleId = '';
      secretId = '';
    }
  }

  private async loadSecrets(): Promise<void> {
    const [appDb, jwt, minio, redis, keycloakApi, keycloakAdminService] =
      await Promise.all([
        this.readSecret('secret/data/app-db/credentials'),
        this.readSecret('secret/data/jwt/signing-key'),
        this.readSecret('secret/data/minio/credentials'),
        this.readSecret('secret/data/redis/credentials'),
        this.readSecret('secret/data/keycloak/nestjs-api'),
        this.readSecret('secret/data/keycloak/keycloak-admin-service'),
      ]);

    this.appDb = {
      username: appDb.username,
      password: appDb.password,
      host: appDb.host,
      port: appDb.port,
      database: appDb.database,
      schema: appDb.schema,
    };
    this.jwt = {
      algorithm: jwt.algorithm,
      privateKey: jwt.private_key,
      publicKey: jwt.public_key,
    };
    this.minio = {
      accessKey: minio.access_key,
      secretKey: minio.secret_key,
      endpoint: minio.endpoint,
      bucket: minio.bucket,
    };
    this.redis = {
      password: redis.password,
      host: redis.host,
      port: redis.port,
    };
    this.keycloakApi = {
      clientId: keycloakApi.client_id,
      clientSecret: keycloakApi.client_secret,
    };
    this.keycloakAdminService = {
      clientId: keycloakAdminService.client_id,
      clientSecret: keycloakAdminService.client_secret,
    };
  }

  private async readSecret(path: string): Promise<Record<string, string>> {
    try {
      const response = (await this.client.read(path)) as KvReadResponse;
      const data = response?.data?.data;
      if (!data) {
        throw new Error('empty response');
      }
      return data;
    } catch {
      // Same reasoning as authenticate(): never log the raw error. Do log
      // *which path* failed — that's a Vault path, not a secret value —
      // since knowing which of the five reads failed is genuinely useful
      // for diagnosing a startup failure without risking exposure.
      this.logger.error(`Failed to read secret at ${path}`);
      throw new Error(`Vault secret read failed for ${path}.`);
    }
  }

  /** Lightweight, unauthenticated reachability check for the health endpoint. */
  async checkHealth(): Promise<boolean> {
    try {
      await this.client.health();
      return true;
    } catch {
      return false;
    }
  }

  getAppDbSecrets(): AppDbSecrets {
    return this.appDb;
  }

  getJwtSecrets(): JwtSecrets {
    return this.jwt;
  }

  getMinioSecrets(): MinioSecrets {
    return this.minio;
  }

  getRedisSecrets(): RedisSecrets {
    return this.redis;
  }

  /** The app's own OIDC client credentials — used to talk to Keycloak at all. */
  getKeycloakApiSecrets(): KeycloakClientSecrets {
    return this.keycloakApi;
  }

  /**
   * Configured but not used this phase — Phase 5's device-switch
   * force-logout capability needs these, not anything built here.
   */
  getKeycloakAdminServiceSecrets(): KeycloakClientSecrets {
    return this.keycloakAdminService;
  }
}
