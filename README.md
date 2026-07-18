- [Devuntu](#devuntu)
- [パッケージ構成](#パッケージ構成)
- [環境変数](#環境変数)
  - [BETTER\_AUTH\_URL](#better_auth_url)
  - [DEFAULT\_LOCALE](#default_locale)
  - [DATABASE\_URL](#database_url)
  - [BETTER\_AUTH\_SECRET](#better_auth_secret)
  - [GOOGLE\_CLIENT\_ID](#google_client_id)
  - [GOOGLE\_CLIENT\_SECRET](#google_client_secret)
  - [開発用](#開発用)
    - [LOG\_LEVEL](#log_level)
- [開発](#開発)
  - [DB起動](#db起動)
  - [DBバックアップ](#dbバックアップ)
  - [DBリストア](#dbリストア)
  - [インストール](#インストール)
  - [ビルド](#ビルド)
  - [パッケージ更新](#パッケージ更新)
  - [better-auth](#better-auth)
  - [イメージ作成](#イメージ作成)
    - [Docker Build](#docker-build)
    - [Docker Hub Push](#docker-hub-push)
  - [sharpの依存関係チェック](#sharpの依存関係チェック)

# Devuntu

# パッケージ構成

- Next.js v16
- pnpm v11
- Prisma v7
- Better Auth v1.6
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

# 環境変数

## BETTER_AUTH_URL

運用するベースのURL

## DEFAULT_LOCALE

## DATABASE_URL

DB(PostgreSQL)のパス

## BETTER_AUTH_SECRET

Better Auth用のシークレット

## GOOGLE_CLIENT_ID

## GOOGLE_CLIENT_SECRET

## 開発用

### LOG_LEVEL

ログレベル

_デフォルト = info_

# 開発

## DB起動

```sh
docker compose up -d db
```

## DBバックアップ

DB(`db`サービス)が起動している状態で実行する。`backup/`配下にタイムスタンプ付き(`.dump`/カスタム形式)で出力される。

```sh
pnpm db:backup
# または
./scripts/backup-db.sh
```

## DBリストア

対象のダンプファイルを引数に指定する。既存オブジェクトは削除された上で復元される。

```sh
pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
# または
./scripts/restore-db.sh backup/devuntu_YYYYMMDD_HHMMSS.dump
```

## インストール

```sh
pnpm install
```

## ビルド

```sh
pnpm build
```

## パッケージ更新

```sh
pnpm up -i
pnpm up -i -L
```

## better-auth

```sh
pnpm dlx auth generate
```

## イメージ作成

### Docker Build

```sh
docker build -f docker/Dockerfile \
             --secret id=database_url,src=docker/database_url.env \
             --secret id=better_auth_url,src=docker/better_auth_url.env \
             --secret id=better_auth_secret,src=docker/better_auth_secret.env \
             -t devuntu .
```

### Docker Hub Push

```sh
docker tag devuntu:latest playree/devuntu:latest
docker push playree/devuntu:latest
```

## sharpの依存関係チェック

基本的に`Next.js`の要求バージョンに揃える

```sh
pnpm why sharp
```
