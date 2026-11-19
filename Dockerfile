FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8001
ENV HOSTNAME=0.0.0.0

RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# standalone 已包含运行所需依赖；不把 Prisma CLI 和构建工具装入运行镜像。
COPY scripts/check-database.mjs scripts/start-server.mjs ./scripts/
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh && \
    mkdir -p /app/data /app/public/uploads /app/approved-images /app/logs && \
    chown -R nextjs:nodejs /app/data /app/public/uploads /app/approved-images /app/logs

USER nextjs

EXPOSE 8001

CMD ["./docker-entrypoint.sh"]
