# ---
# ビルド環境
# ---
FROM node:24-slim AS builder
WORKDIR /app

RUN corepack enable pnpm

# 依存の解決はソースを変えるたびにやり直さないよう、入力になるファイルだけ先に入れる
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Prisma Migrate用
RUN mkdir migrate && cd migrate \
    && npm init -y \
    && npm install prisma@$(node -p "require('/app/node_modules/prisma/package.json').version")

# ソースをコピー
COPY . .

# ビルド。secret はビルドを通すためだけに要るもので、中身は docker/dummy-secrets のダミー値
RUN --mount=type=secret,id=database_url \
    --mount=type=secret,id=better_auth_secret \
    --mount=type=secret,id=better_auth_url \
    DATABASE_URL=$(cat /run/secrets/database_url) \
    BETTER_AUTH_URL=$(cat /run/secrets/better_auth_url) \
    BETTER_AUTH_SECRET=$(cat /run/secrets/better_auth_secret) \
    pnpm build

# ---
# 実行環境
# ---
FROM node:24-slim AS runner
WORKDIR /app

# openssh-client はコマンド実行機能(COMMAND_EXEC_ENABLED)が spawn する ssh 本体。
# ssh2 などの npm パッケージを使わないのは、output: 'standalone' に native 依存を持ち込まないため。
#
# postgresql-client は tools サービスの db-backup / db-restore が使う(pg_dump / pg_restore / psql)。
# Debian 標準のリポジトリはメジャーバージョンが古く、新しいサーバからは dump できないため PGDG から入れる。
# バージョンは compose.yaml の db サービス(postgres:18)と揃えること。
# ディストリのコード名は /etc/os-release から取り、ベースイメージの更新で壊れないようにする
RUN apt-get update -y \
    && apt-get install -y openssl openssh-client ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
         -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
         > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update -y && apt-get install -y postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

# /usr/bin の pg_dump は pg_wrapper 経由でバージョンを解決するため、実体のあるパスを先に見せる
ENV PATH=/usr/lib/postgresql/18/bin:$PATH

# 実行に必要なファイルをビルド環境からコピー
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

COPY --from=builder /app/migrate ./migrate
COPY --from=builder /app/prisma.config.ts ./migrate/prisma.config.ts
COPY --from=builder /app/prisma ./migrate/prisma
RUN mkdir /app/db && ln -s /app/db /app/migrate/db

# 運用スクリプト(compose.yaml の tools サービスから tools.mjs 経由で実行する)
COPY --from=builder /app/scripts/tools.mjs \
                    /app/scripts/run-script.mjs \
                    /app/scripts/db-connect.mjs \
                    /app/scripts/backup-db.mjs \
                    /app/scripts/restore-db.mjs \
                    /app/scripts/backup-s3.mjs \
                    /app/scripts/restore-s3.mjs \
                    /app/scripts/backup-all.mjs \
                    /app/scripts/restore-all.mjs \
                    /app/scripts/maintenance.mjs \
                    ./scripts/
COPY --from=builder /app/scripts/setup-env ./scripts/setup-env

# エントリーポイントスクリプトをコピー
COPY --from=builder /app/docker/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
# Docker はコンテナ内の HOSTNAME にコンテナIDを入れ、standalone の server.js はそれを listen 先に使う。
# そのままだとコンテナのIPでしか listen せず、healthcheck の localhost から届かないため全アドレスで待ち受ける
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
