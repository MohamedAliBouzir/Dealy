import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { MinioModule } from '../minio/minio.module';
import { RedisModule } from '../redis/redis.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, KeycloakModule, MinioModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
