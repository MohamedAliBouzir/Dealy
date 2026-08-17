import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  // Fail loud, fail visibly, exit non-zero — never let a startup failure
  // (Vault unreachable, AppRole auth failed, etc.) leave the process
  // hanging or silently running without its secrets. Only ever log
  // `.message`, never the raw error object — see VaultService for why.
  const message = error instanceof Error ? error.message : 'Unknown error';
  Logger.error(`Application failed to start: ${message}`, 'Bootstrap');
  process.exit(1);
});
