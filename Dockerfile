# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json .npmrc ./

RUN npm ci

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma 7's client is generated code (gitignored, not committed) — it has
# to exist before `nest build`'s tsc pass can compile code that imports it.
# generate doesn't connect to a database, but prisma.config.ts resolves
# DATABASE_URL eagerly regardless, so a placeholder satisfies it here; the
# real value is only ever supplied at runtime, from Vault, never baked in.
RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" npx prisma generate

RUN npm run build

# ---- Stage 3: Production image ----
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies. --ignore-scripts: the "prepare"
# script runs husky, a devDependency omitted here — without this flag the
# install fails outright (husky: not found, exit 127). Lifecycle scripts
# like git-hook setup have no purpose in a container with no .git anyway.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from build stage
COPY --from=build /app/dist ./dist

# Run as non-root user for security
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs
USER nestjs

EXPOSE 3000

CMD ["node", "dist/main"]
