- [Devuntu](#devuntu)
- [パッケージ構成](#パッケージ構成)
- [環境変数](#環境変数)
  - [基本](#基本)
  - [認証](#認証)
  - [メール](#メール)
  - [Linode](#linode)
  - [Debug](#debug)
  - [補足](#補足)
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

環境変数の定義元は `src/lib/env-util.ts`。参照時も同ファイルの `envu` を利用する。

## 基本

| 変数名                 | 説明                         | 必須 | デフォルト   |
| ---------------------- | ---------------------------- | ---- | ------------ |
| `NEXT_PUBLIC_APP_NAME` | アプリ名（クライアント公開） |      | `Devuntu`    |
| `DATABASE_URL`         | DB(PostgreSQL) の接続パス    | 〇   | -            |
| `DEFAULT_LOCALE`       | デフォルトロケール           |      | -            |
| `DEFAULT_TIMEZONE`     | デフォルトタイムゾーン       |      | `Asia/Tokyo` |
| `LOG_LEVEL`            | ログレベル                   |      | `info`       |

## 認証

| 変数名                       | 説明                                  | 必須 | デフォルト    |
| ---------------------------- | ------------------------------------- | ---- | ------------- |
| `BETTER_AUTH_URL`            | 運用するベースの URL                  | 〇   | -             |
| `BETTER_AUTH_SECRET`         | Better Auth 用シークレット            | 〇   | -             |
| `SESSION_EXPIRES_IN`         | セッション有効期間(秒)                |      | `432000`(5日) |
| `SESSION_FRESH_AGE`          | セッション fresh 期間(秒)             |      | `86400`(1日)  |
| `TWO_FA_REQUIRED`            | 2要素認証を必須にするか               |      | `true`        |
| `DISABLE_PASSWORD_AUTH`      | パスワード認証を無効化                |      | `false`       |
| `MAIN_DEVUNTU_URL`           | 連携元 Devuntu の URL                 |      | -             |
| `MAIN_DEVUNTU_CLIENT_ID`     | 連携元クライアントID                  |      | -             |
| `MAIN_DEVUNTU_CLIENT_SECRET` | 連携元クライアントシークレット        |      | -             |
| `GOOGLE_CLIENT_ID`           | Google OAuth クライアントID           |      | -             |
| `GOOGLE_CLIENT_SECRET`       | Google OAuth クライアントシークレット |      | -             |
| `GOOGLE_ALLOWED_DOMAINS`     | 許可ドメイン(カンマ区切り)            |      | -             |

## メール

| 変数名             | 説明                                          | 必須                    | デフォルト |
| ------------------ | --------------------------------------------- | ----------------------- | ---------- |
| `MAIL_SEND`        | 送信方式 `sendgrid`/`sendmail`/`smtp`/`debug` |                         | -          |
| `MAIL_FROM`        | 送信元アドレス                                | 〇                      | -          |
| `SENDGRID_API_KEY` | SendGrid APIキー                              | `MAIL_SEND=sendgrid` 時 | -          |
| `SENDMAIL_PATH`    | sendmail のパス                               | `MAIL_SEND=sendmail` 時 | -          |
| `SMTP_HOST`        | SMTP ホスト                                   | `MAIL_SEND=smtp` 時     | -          |
| `SMTP_PORT`        | SMTP ポート                                   | `MAIL_SEND=smtp` 時     | -          |
| `SMTP_IGNORE_TLS`  | TLS を無視                                    |                         | `false`    |
| `SMTP_SECURE`      | SSL/TLS 接続                                  |                         | `false`    |
| `SMTP_USER`        | SMTP 認証ユーザー                             |                         | -          |
| `SMTP_PASS`        | SMTP 認証パスワード                           |                         | -          |

## Linode

| 変数名                         | 説明                    | 必須 | デフォルト |
| ------------------------------ | ----------------------- | ---- | ---------- |
| `LINODE_ID`                    | Linode インスタンスID   |      | -          |
| `LINODE_PERSONAL_ACCESS_TOKEN` | Linode アクセストークン |      | -          |

## Debug

| 変数名               | 説明                    | 必須 | デフォルト |
| -------------------- | ----------------------- | ---- | ---------- |
| `DEBUG_LINODE_DUMMY` | Linode ダミー応答(JSON) |      | -          |

## 補足

以下はユーザーが直接設定しない内部変数。

- `BUILD_NO` : ビルド番号。`next.config.ts` の `env` で自動生成・注入される
- `NODE_ENV` : 実行環境(`development`/`production` 等)。実行環境側で設定される

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

docker tag devuntu:latest playree/devuntu:0.2.0
docker push playree/devuntu:0.2.0
```

※`0.2.0`のバージョンタグはサンプル

## sharpの依存関係チェック

基本的に`Next.js`の要求バージョンに揃える

```sh
pnpm why sharp
```
