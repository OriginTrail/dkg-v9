# ── Stage 1: Build ──────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY patches/ patches/
COPY packages/ packages/
COPY demo/ demo/
COPY network/ network/

RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── Stage 2: Runtime ────────────────────────────────────────────────
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build /app

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENV DKG_HOME=/data
RUN mkdir -p /data

EXPOSE 9200

ENTRYPOINT ["tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
