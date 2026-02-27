# ─── Edda Multi-stage Dockerfile ──────────────────────────────────
# Builds both the server and web apps for production deployment.

# ── Stage 1: Install + Build ───────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable pnpm

WORKDIR /app

# Copy workspace config first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/cli/package.json packages/cli/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/ apps/

# Build everything
RUN pnpm build

# ── Stage 2: Production server ─────────────────────────────────────
FROM node:20-slim AS server

RUN corepack enable pnpm

WORKDIR /app

COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/db/dist packages/db/dist/
COPY --from=builder /app/packages/db/migrations packages/db/migrations/
COPY --from=builder /app/apps/server/package.json apps/server/
COPY --from=builder /app/apps/server/dist apps/server/dist/

RUN pnpm install --frozen-lockfile --prod

# Run migrations then start
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node packages/db/dist/seed-settings.js && node apps/server/dist/index.js"]

EXPOSE 8000

# ── Stage 3: Production web ────────────────────────────────────────
FROM node:20-slim AS web

RUN corepack enable pnpm

WORKDIR /app

COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY --from=builder /app/apps/web/package.json apps/web/
COPY --from=builder /app/apps/web/.next apps/web/.next/
COPY --from=builder /app/apps/web/public apps/web/public/
COPY --from=builder /app/node_modules apps/web/node_modules/

RUN pnpm install --frozen-lockfile --prod

CMD ["pnpm", "--filter", "@edda/web", "start"]

EXPOSE 3000
