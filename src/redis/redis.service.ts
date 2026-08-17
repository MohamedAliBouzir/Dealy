import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { VaultService } from '../vault/vault.service';

/**
 * Connection only, per the brief — no BullMQ, no grace-period timers, just
 * a live client and a way to prove it's reachable. The password is read
 * from Vault (via VaultService), never from `.env` directly — `.env`'s
 * copy exists only to boot the Redis *container* itself.
 *
 * Client is built in onModuleInit, not the constructor — VaultService only
 * populates its secrets in its own onModuleInit, which Nest guarantees
 * runs before this one's (dependency-ordered), but not before this class's
 * constructor. See PrismaService for the fuller explanation; same bug,
 * same fix, hit here for real on the first live smoke test.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | undefined;

  constructor(private readonly vault: VaultService) {}

  onModuleInit(): void {
    const { password, host, port } = this.vault.getRedisSecrets();
    this.client = new Redis({
      host,
      port: Number(port),
      password,
      lazyConnect: true,
      // Bounded retry, not infinite — a health check should be able to
      // report "down" rather than hang waiting on ioredis's own retry loop.
      maxRetriesPerRequest: 2,
    });
  }

  onModuleDestroy(): void {
    this.client?.disconnect();
  }

  async checkHealth(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      if (this.client.status === 'wait' || this.client.status === 'end') {
        await this.client.connect();
      }
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch {
      this.logger.warn('Redis connectivity check failed.');
      return false;
    }
  }
}
