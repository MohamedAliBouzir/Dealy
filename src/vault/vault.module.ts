import { Global, Module } from '@nestjs/common';
import { VaultService } from './vault.service';

/**
 * Global: almost every other module (database, Keycloak, Redis, MinIO)
 * needs secrets from here, so it's provided once and injected everywhere
 * rather than re-imported per-module.
 */
@Global()
@Module({
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
