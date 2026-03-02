# ── Stage 1: Base ─────────────────────────────────────
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ── Stage 2: Dependencies (cached layer) ─────────────
FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ── Stage 4: Production ──────────────────────────────
FROM node:20-slim AS production
WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 edda --ingroup nodejs

# Install pnpm for production deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Install production dependencies
COPY --from=deps /app/pnpm-lock.yaml /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/apps/server/package.json apps/server/
COPY --from=deps /app/packages/db/package.json packages/db/
COPY --from=deps /app/packages/cli/package.json packages/cli/
COPY --from=deps /app/apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod

# Server compiled output + skills
COPY --from=build --chown=edda:nodejs /app/apps/server/dist apps/server/dist
COPY --from=build --chown=edda:nodejs /app/apps/server/skills apps/server/skills

# DB compiled output + migrations
COPY --from=build --chown=edda:nodejs /app/packages/db/dist packages/db/dist
COPY --from=build --chown=edda:nodejs /app/packages/db/migrations packages/db/migrations

# Next.js standalone output (traces workspace deps automatically)
COPY --from=build --chown=edda:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=edda:nodejs /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=edda:nodejs /app/apps/web/public apps/web/public

USER edda
EXPOSE 3000 8000
CMD ["node", "apps/server/dist/index.js"]
