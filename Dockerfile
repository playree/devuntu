# ---
# ビルド環境
# ---
FROM node:24-slim AS builder
WORKDIR /app

# ソースをコピー
COPY . .

# ビルド
RUN corepack enable pnpm
RUN pnpm install --frozen-lockfile
RUN --mount=type=secret,id=database_url \
    --mount=type=secret,id=better_auth_secret \
    --mount=type=secret,id=better_auth_url \
    DATABASE_URL=$(cat /run/secrets/database_url) \
    BETTER_AUTH_URL=$(cat /run/secrets/better_auth_url) \
    BETTER_AUTH_SECRET=$(cat /run/secrets/better_auth_secret) \
    pnpm build

# Prisma CLI を依存ごと隔離ディレクトリにインストール
RUN mkdir migrate && cd migrate \
    && npm install prisma

# ---
# 実行環境
# ---
FROM node:24-slim AS runner
WORKDIR /app

# 実行に必要なファイルをビルド環境からコピー
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

COPY --from=builder /app/migrate ./migrate
COPY --from=builder /app/prisma.config.ts ./migrate/prisma.config.ts
COPY --from=builder /app/prisma ./migrate/prisma

# エントリーポイントスクリプトをコピー
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000

# ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
