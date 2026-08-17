import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { KeycloakModule } from './keycloak/keycloak.module';
import { MinioModule } from './minio/minio.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    // isGlobal + no envFilePath: config comes from the container's actual
    // environment (docker-compose's `environment:` block), not a .env file
    // read by the app itself — .env is a host-side local-dev convenience
    // for docker compose, not something the containerized app reads.
    ConfigModule.forRoot({ isGlobal: true }),
    VaultModule,
    PrismaModule,
    KeycloakModule,
    RedisModule,
    MinioModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
