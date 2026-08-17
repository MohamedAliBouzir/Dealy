import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { KeycloakService } from '../keycloak/keycloak.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { VaultService } from '../vault/vault.service';

/**
 * Infrastructure verification, not a feature — reports live connectivity
 * for every dependency this phase wired up. Genuinely useful operationally
 * going forward, not just for this phase's sign-off.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly vault: VaultService,
    private readonly keycloak: KeycloakService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly minio: MinioService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        const indicator = this.indicator.check('vault');
        return (await this.vault.checkHealth())
          ? indicator.up()
          : indicator.down();
      },
      async () => {
        const indicator = this.indicator.check('keycloak');
        return (await this.keycloak.checkHealth())
          ? indicator.up()
          : indicator.down();
      },
      async () => {
        const indicator = this.indicator.check('database');
        return (await this.prisma.checkHealth())
          ? indicator.up()
          : indicator.down();
      },
      async () => {
        const indicator = this.indicator.check('redis');
        return (await this.redis.checkHealth())
          ? indicator.up()
          : indicator.down();
      },
      async () => {
        const indicator = this.indicator.check('minio');
        return (await this.minio.checkHealth())
          ? indicator.up()
          : indicator.down();
      },
    ]);
  }
}
