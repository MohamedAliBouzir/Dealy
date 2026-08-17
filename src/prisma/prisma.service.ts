import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { VaultService } from '../vault/vault.service';

/**
 * The app's own runtime connection — dedicated `app_user` role, credentials
 * from Vault, never `.env`. Uses Prisma 7's driver-adapter pattern
 * (`@prisma/adapter-pg`), configured with discrete pool fields rather than
 * a connection-string URL, which sidesteps URL-encoding entirely for
 * whatever characters happen to be in a generated password.
 *
 * Composition, not inheritance: PrismaClient needs its adapter (and thus
 * Vault's secrets) at construction time, but VaultService only populates
 * those secrets in its own onModuleInit — which runs *after* every
 * provider's constructor, not before. Extending PrismaClient directly and
 * reading Vault secrets in this class's constructor crashes at startup
 * ("Cannot destructure property 'username' of ... undefined") because
 * VaultService hasn't fetched anything yet at that point. Building the
 * real client here in onModuleInit instead works because Nest's lifecycle
 * hooks — unlike constructors — do respect the dependency graph:
 * VaultService.onModuleInit is guaranteed to run before this one's, since
 * this service depends on it.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private client: PrismaClient | undefined;

  constructor(private readonly vault: VaultService) {}

  async onModuleInit(): Promise<void> {
    const { username, password, host, port, database, schema } =
      this.vault.getAppDbSecrets();
    this.client = new PrismaClient({
      adapter: new PrismaPg(
        {
          user: username,
          password,
          host,
          port: Number(port),
          database,
        },
        { schema },
      ),
    });
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  async checkHealth(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      this.logger.warn('Database connectivity check failed.');
      return false;
    }
  }
}
