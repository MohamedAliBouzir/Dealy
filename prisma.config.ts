import { defineConfig, env } from 'prisma/config';

// Connection info for the Prisma CLI (migrate, generate) only — never a
// literal value here. DATABASE_URL is supplied as a process env var at
// invocation time, built from Vault-sourced app_user credentials and never
// persisted to a file or committed. The running application itself does
// not use this file or DATABASE_URL — see src/prisma/prisma.service.ts,
// which builds its own connection string from VaultService at startup.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
