# syntax=docker/dockerfile:1

# ---- Base: Node + pnpm via Corepack ----
FROM node:26-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Node 25+ no longer bundles corepack, so install pnpm directly. Keep the
# version in sync with the "packageManager" field in package.json.
RUN npm install -g pnpm@11.17.0
WORKDIR /repo

# ---- Build: install everything, build web + api, prune to prod ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Turbo builds @rss/web (vite) and @rss/api (tsup, which bundles @rss/shared).
RUN pnpm build
# Produce a self-contained production deployment of the API. --legacy keeps the
# pre-pnpm-v10 deploy behavior: @rss/shared is bundled into the API by tsup, so
# we don't need injected workspace packages, just the external prod deps.
RUN pnpm --filter @rss/api deploy --legacy --prod /app/api
# Ship the built SPA so the API can serve it from the same origin.
RUN cp -r apps/web/dist /app/web

# ---- Runtime: minimal image with only what the API needs ----
FROM node:26-slim AS runtime
ENV NODE_ENV=production
ENV WEB_DIST=/app/web
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build --chown=appuser:appuser /app/api ./
COPY --from=build --chown=appuser:appuser /app/web ./web
USER appuser
EXPOSE 3000
# Default to the API server; docker-compose overrides the command for the
# worker and the one-shot migration step.
CMD ["node", "dist/server.js"]
