import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from 'minio';
import { VaultService } from '../vault/vault.service';

/**
 * Connection only, per the brief — no upload/download endpoints yet. Uses
 * the dedicated, scoped access key from Vault (`secret/minio/credentials`),
 * never MinIO's root credentials.
 *
 * Client is built in onModuleInit, not the constructor — see PrismaService
 * for why (VaultService's secrets aren't populated until its own
 * onModuleInit, which Nest orders before this one's, but not before this
 * class's constructor runs).
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Client | undefined;
  private bucket: string | undefined;

  constructor(private readonly vault: VaultService) {}

  onModuleInit(): void {
    const { accessKey, secretKey, endpoint, bucket } =
      this.vault.getMinioSecrets();
    const [host, port] = endpoint.split(':');
    this.client = new Client({
      endPoint: host,
      port: Number(port),
      useSSL: false,
      accessKey,
      secretKey,
    });
    this.bucket = bucket;
  }

  async checkHealth(): Promise<boolean> {
    try {
      if (!this.client || !this.bucket) {
        return false;
      }
      // bucketExists() on the one bucket this key is scoped to, not
      // listBuckets() — the scoped policy only grants s3:ListBucket on
      // the "dealy" bucket specifically, not the account-wide
      // s3:ListAllMyBuckets that listBuckets() needs. That's the
      // least-privilege scoping working as intended, not a workaround.
      return await this.client.bucketExists(this.bucket);
    } catch {
      this.logger.warn('MinIO connectivity check failed.');
      return false;
    }
  }
}
