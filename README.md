- [Devuntu](#devuntu)
- [パッケージ構成](#パッケージ構成)
- [画面一覧](#画面一覧)
  - [アクセス制御の仕組み](#アクセス制御の仕組み)
  - [一般](#一般)
  - [タスク管理](#タスク管理)
  - [管理者](#管理者)
  - [認証・公開](#認証公開)
  - [API](#api)
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
  - [パッケージへのパッチ](#パッケージへのパッチ)
    - [@heroui/react](#herouireact)
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

# 画面一覧

## アクセス制御の仕組み

パス単位の制御は `src/proxy.ts`(Next.js Proxy)が `src/lib/auth-config.ts` の設定に従って行う。

- **認証必須** : `/auth/signin` `/start` `/cal/:id` 以外の全ページ。未ログインは `/auth/signin?cb=<元のURL>` へリダイレクト
- **管理者のみ** : `/admin/**`。`role !== 'admin'` の場合は 404 へ rewrite(メニューにも表示されない)
- **2要素認証** : `TWO_FA_REQUIRED=true` かつ `DISABLE_PASSWORD_AUTH=false` の場合、2FA未設定なら `/auth/signin?mode=2FA` へリダイレクト
- Proxy の matcher は `api/**` と Server Action(`next-action` ヘッダ)を除外している。そのためレコード単位の認可(ボード/チケットの参照・編集権限)は各 Server Action 側で `assertBoardAccess` / `assertTicketAccess`(`src/lib/board.ts`)により検証する

ボードの権限は直接メンバー(`BoardMember`)またはグループ経由(`BoardGroup`)で解決され、`owner` / `member` のロールを持つ。

## 一般

| 画面名称       | パス       | アクセス制御                                                                    |
| -------------- | ---------- | ------------------------------------------------------------------------------- |
| ダッシュボード | `/`        | 認証必須                                                                        |
| カレンダー     | `/cal`     | 認証必須 + Googleアカウント連携が利用可能なユーザーのみ(不可の場合は案内を表示) |
| アカウント     | `/account` | 認証必須(自分のアカウント情報のみ)                                              |

## タスク管理

| 画面名称     | パス                    | アクセス制御                                                                               |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| ボード一覧   | `/boards`               | 認証必須(自分がアクセスできるボードのみ表示)                                               |
| かんばん     | `/boards/[id]`          | 認証必須 + 対象ボードの参照権限(`owner` / `member`)                                        |
| ボード設定   | `/boards/[id]/settings` | 認証必須 + 対象ボードの参照権限。メンバー/グループ/タグ等の変更は `owner` または管理者のみ |
| チケット一覧 | `/tickets`              | 認証必須(アクセスできるボードのチケットのみ表示)                                           |
| チケット詳細 | `/tickets/[id]`         | 認証必須 + 対象チケットの参照権限(所属ボード経由で判定)                                    |

## 管理者

いずれも `/admin/**` 配下のため管理者(`role === 'admin'`)のみアクセス可能。

| 画面名称           | パス                  | アクセス制御 |
| ------------------ | --------------------- | ------------ |
| ユーザー管理       | `/admin/users`        | 管理者のみ   |
| グループ管理       | `/admin/groups`       | 管理者のみ   |
| ダッシュボード管理 | `/admin/dashboard`    | 管理者のみ   |
| 設定(連携設定)     | `/admin/settings`     | 管理者のみ   |
| OIDCクライアント   | `/admin/oidc-clients` | 管理者のみ   |

## 認証・公開

| 画面名称         | パス           | アクセス制御                                                                             |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------- |
| サインイン       | `/auth/signin` | 認証不要。`?mode=2FA` で2FA設定の誘導、`?cb=` でサインイン後の遷移先を指定               |
| 初期セットアップ | `/start`       | 認証不要。初期セットアップ済みの場合は `/` へリダイレクト                                |
| 空き時間の共有   | `/cal/[id]`    | **認証不要の公開ページ**。共有URLの `publicId` で参照。無効化済み/不正なIDは404。noindex |

## API

Proxy の対象外のため、各ルートハンドラ内で個別に認証する。

| パス                                         | アクセス制御                         |
| -------------------------------------------- | ------------------------------------ |
| `/api/auth/[...all]`                         | Better Auth のハンドラ(認証処理自体) |
| `/api/auth/.well-known/openid-configuration` | 認証不要(OIDC ディスカバリ)          |
| `/api/health`                                | 認証不要(ヘルスチェック)             |
| `/api/upload/[filename]`                     | 認証必須(未ログインは401)            |

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

## パッケージへのパッチ

`patches/`配下に`pnpm patch`で作成したパッチを置いている。登録先は`pnpm-workspace.yaml`の`patchedDependencies`で、`pnpm install`時に自動適用される。

**パッチ対象パッケージをバージョンアップした場合は、パッチの当て直しが必要。**

```sh
# 1. 編集用の一時ディレクトリを作成(パスが出力される)
pnpm patch @heroui/react

# 2. 出力されたパス配下のファイルを編集

# 3. パッチとして確定(patches/配下に保存され pnpm-workspace.yaml に登録される)
pnpm patch-commit '<出力されたパス>'
```

### @heroui/react

| パッチ                         | 対象バージョン | 内容                                                                                       |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------ |
| `patches/@heroui__react.patch` | 3.2.2          | `Autocomplete.Popover`が`aria-label`/`aria-labelledby`を内部の`Dialog`へ転送するようにする |

`Autocomplete.Popover`は内部で react-aria の`Dialog`を挟むが、受け取った props は外側の`Popover`にしか展開されず`Dialog`にラベルを渡す手段が無い。そのため開発時に以下の警告が出続ける。

```
If a Dialog does not contain a <Heading slot="title">, it must have an aria-label or
aria-labelledby attribute for accessibility.
```

- `<Heading slot="title">`では解決できない。react-aria の`Select`はコレクション構築のため children ツリーを`<template>`内で描画し、`Dialog`は`document.getElementById`で見出しを探すため、この pass では必ず見つからず警告になる(ポップオーバーを開く前、マウント時から出る)
- 利用側は`<Autocomplete.Popover aria-label={...}>`を渡すだけでよい。`src/components/ticket/tag-select.tsx`が該当
- 上流(HeroUI)側の不備なので、修正されたらこのパッチは削除する

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
