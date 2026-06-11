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
- [開発用](#開発用-1)
  - [インストール](#インストール)
  - [ビルド](#ビルド)
  - [パッケージ更新](#パッケージ更新)
- [better-auth](#better-auth)
- [イメージ作成](#イメージ作成)
  - [Docker Build](#docker-build)
  - [Docker Hub Push](#docker-hub-push)

# Devuntu

# パッケージ構成

- Next.js v16
- pnpm v10
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

DB(SQLite)のファイルパス

## BETTER_AUTH_SECRET

Better Auth用のシークレット

## GOOGLE_CLIENT_ID

## GOOGLE_CLIENT_SECRET

## 開発用

### LOG_LEVEL

ログレベル

_デフォルト = info_

# 開発用

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

# better-auth

```sh
pnpm dlx auth generate
```

# イメージ作成

## Docker Build

```sh
cd docker
docker build --secret id=database_url,src=database_url.env \
             --secret id=better_auth_url,src=better_auth_url.env \
             --secret id=better_auth_secret,src=better_auth_secret.env \
             -t devuntu .
```

## Docker Hub Push
