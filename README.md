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
  - [オブジェクトストレージ](#オブジェクトストレージ)
  - [Linode](#linode)
  - [Debug](#debug)
  - [補足](#補足)
- [開発](#開発)
  - [開発用インフラ起動](#開発用インフラ起動)
  - [オブジェクトストレージへの移行](#オブジェクトストレージへの移行)
  - [DBバックアップ](#dbバックアップ)
  - [DBリストア](#dbリストア)
  - [インストール](#インストール)
  - [ビルド](#ビルド)
  - [パッケージ更新](#パッケージ更新)
  - [パッケージへのパッチ](#パッケージへのパッチ)
  - [パッケージのバージョン上書き](#パッケージのバージョン上書き)
    - [tailwind-variants](#tailwind-variants)
  - [better-auth](#better-auth)
  - [イメージ作成](#イメージ作成)
    - [Docker Build](#docker-build)
    - [Docker Hub Push](#docker-hub-push)
  - [sharpの依存関係チェック](#sharpの依存関係チェック)

# Devuntu

# パッケージ構成

- Next.js v16
- TypeScript v7
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

| パス                                         | アクセス制御                                      |
| -------------------------------------------- | ------------------------------------------------- |
| `/api/auth/[...all]`                         | Better Auth のハンドラ(認証処理自体)              |
| `/api/auth/.well-known/openid-configuration` | 認証不要(OIDC ディスカバリ)                       |
| `/api/health`                                | 認証不要(ヘルスチェック)                          |
| `/api/upload`                                | 認証必須(未ログインは401)。画像アップロード(POST) |
| `/api/upload/[filename]`                     | 認証必須(未ログインは401)。画像配信(GET)          |

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

## オブジェクトストレージ

アップロードファイル(画像)の保存先。S3互換APIを話すストレージであれば何でもよいが、`compose.yaml` では OSS の [SeaweedFS](https://github.com/seaweedfs/seaweedfs) を同梱している。認証情報は `docker/seaweedfs-s3.json` で定義する。

| 変数名                 | 説明                                 | 必須 | デフォルト  |
| ---------------------- | ------------------------------------ | ---- | ----------- |
| `S3_ENDPOINT`          | S3 API のエンドポイント              | 〇   | -           |
| `S3_BUCKET`            | バケット名(存在しない場合は自動作成) |      | `devuntu`   |
| `S3_REGION`            | リージョン(SeaweedFS では任意値)     |      | `us-east-1` |
| `S3_ACCESS_KEY_ID`     | アクセスキー                         | 〇   | -           |
| `S3_SECRET_ACCESS_KEY` | シークレットキー                     | 〇   | -           |
| `S3_FORCE_PATH_STYLE`  | パススタイルのアドレッシングを強制   |      | `true`      |

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

## 開発用インフラ起動

開発に必要なのは DB(`db`サービス)とオブジェクトストレージ(`s3`サービス)のみ。まとめて起動・停止する。

```sh
# 起動
docker compose up -d db s3

# 停止
docker compose stop db s3
```

DB は `localhost:5432`、S3 API は `localhost:8333` で公開される。アップロード機能を使うには S3 API が必要。

## オブジェクトストレージへの移行

ローカル保存(`upload/`)からの移行は一度だけ以下を実行する。ファイル名をそのままオブジェクトキーにするため、DB の `iconPath` は書き換えなくてよい。何度実行しても既存分はスキップされる。

```sh
pnpm upload:migrate
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

現在適用中のパッチは無い。`@heroui/react` 3.2.2 では`Autocomplete.Popover`が`aria-label`/`aria-labelledby`を内部の`Dialog`へ転送せず react-aria の警告が出続けるためパッチを当てていたが、3.2.3 で本体が修正されたため削除した。

## パッケージのバージョン上書き

依存パッケージが固定しているバージョンに問題がある場合は、`pnpm-workspace.yaml`の`overrides`で差し替える。`パッケージ名>依存パッケージ名`の形式で書くと、そのパッケージの入れ子依存だけを対象にできる。

### tailwind-variants

| 上書き対象                         | 指定     | 理由                                                         |
| ---------------------------------- | -------- | ------------------------------------------------------------ |
| `@heroui/styles>tailwind-variants` | `^3.3.1` | HeroUI 3.2.3 が固定する`tailwind-variants@3.3.0`のバグを回避 |
| `@heroui/react>tailwind-variants`  | `^3.3.1` | 同上(コピーを 1 本に集約する)                                |

`tailwind-variants` 3.3.0 の slots リゾルバは、

- tv インスタンスごとに**単一の slots オブジェクトを使い回して返す**
- 各 slot 関数は呼び出し時にモジュールスコープの「最後に渡された props」を読む(呼び出し元の props を捕捉しない)

という実装のため、同じ tv を別の props で呼ぶと**先に取得済みの slot 関数の戻り値まで後の props に化ける**。

HeroUI の`Modal`はこのパターンを踏んでいる。`Modal.Backdrop`は`useMemo(() => modalVariants({ variant }), [variant])`の結果を保持して毎レンダリングで`slots.backdrop()`を呼ぶが、後から描画される`Modal.Container`が同じ tv を`{ scroll, size }`(variant 無し)で呼ぶ。以降`Modal.Backdrop`が再レンダリングされても`useMemo`はヒットして`modalVariants`を呼び直さないため、`backdrop()`が`variant`の既定値である`modal__backdrop--opaque`を返す。結果、`FormModal`(`src/components/general/modal.tsx`)の`variant='blur'`が効かなくなっていた。`Drawer`/`AlertDialog`も同じ呼び出し方をしている。

- 3.3.1 で修正済み(slots オブジェクトを呼び出しごとに生成する形に戻っている)
- HeroUI をバージョンアップする際は`@heroui/styles`の`dependencies.tailwind-variants`を確認し、3.3.1 以上になっていればこの override は削除できる
- `@heroui/react`側も同じ 3.3.0 を持ち`tv`/`cn`を再エクスポートしているため、揃えて上書きしている(コピーが 1 本に集約される)

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
