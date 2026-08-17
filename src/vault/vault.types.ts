export interface AppDbSecrets {
  username: string;
  password: string;
  host: string;
  port: string;
  database: string;
  schema: string;
}

export interface JwtSecrets {
  algorithm: string;
  privateKey: string;
  publicKey: string;
}

export interface MinioSecrets {
  accessKey: string;
  secretKey: string;
  endpoint: string;
  bucket: string;
}

export interface RedisSecrets {
  password: string;
  host: string;
  port: string;
}

/** Shape shared by both Keycloak client credential pairs stored in Vault. */
export interface KeycloakClientSecrets {
  clientId: string;
  clientSecret: string;
}
