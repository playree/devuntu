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
  - [s3-toolsサービス](#s3-toolsサービス)
    - [旧イメージでの実行](#旧イメージでの実行)
  - [DBバックアップ](#dbバックアップ)
  - [DBリストア](#dbリストア)
  - [S3バックアップ](#s3バックアップ)
    - [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)
  - [S3リストア](#s3リストア)
    - [Docker環境でのS3リストア](#docker環境でのs3リストア)
    - [ボリュームを作り直す場合](#ボリュームを作り直す場合)
  - [インストール](#インストール)
  - [ビルド](#ビルド)
  - [パッケージ更新](#パッケージ更新)
  - [パッケージへのパッチ](#パッケージへのパッチ)
  - [パッケージのバージョン上書き](#パッケージのバージョン上書き)
    - [tailwind-variants](#tailwind-variants)
  - [TypeScript v7 と v6 の併存](#typescript-v7-と-v6-の併存)
  - [better-auth](#better-auth)
  - [イメージ作成](#イメージ作成)
    - [Docker Build](#docker-build)
    - [Docker Hub Push](#docker-hub-push)
  - [sharpの依存関係チェック](#sharpの依存関係チェック)

# Devuntu

# パッケージ構成

- Next.js v16
- TypeScript v7(v6 と併存。[TypeScript v7 と v6 の併存](#typescript-v7-と-v6-の併存))
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

## s3-toolsサービス

`compose.yaml` で Docker 運用している環境向けに、S3 のバックアップ/リストアスクリプトを実行するための使い捨てコンテナを `s3-tools` サービスとして定義している。スクリプトはイメージに同梱されているので、**リポジトリの clone もホストへの node インストールも不要**で、`compose.yaml` と `.env.docker` があれば実行できる。

```sh
mkdir -p backup

# バックアップ(既定のコマンド)
docker compose run --rm s3-tools

# リストアは引数でスクリプトを指定する
docker compose run --rm s3-tools /app/scripts/restore-s3.mjs /app/backup/s3_YYYYMMDD_HHMMSS
```

- 同梱版イメージ(`0.3.1` 以降)が前提。それ以前のイメージでは[旧イメージでの実行](#旧イメージでの実行)を参照する
- `profiles: ['tools']` を付けているので `docker compose up` では起動しない
- `entrypoint` を `node` にしているので `docker-entrypoint.sh` が動かず、`prisma migrate deploy` は走らない
- 環境変数は `env_file`(`.env.docker`)から渡るので、コンテナ内の `S3_ENDPOINT` は `http://s3:8333` になる
- `depends_on` の `condition: service_healthy` により、`s3` が停止していれば起動し、healthcheck が通るまで待ってからスクリプトが実行される
- `./backup` をマウントしているので、入出力先は `compose.yaml` と同じ階層の `backup/`。引数のパスは**コンテナ内のパス**(`/app/backup/...`)で指定する
- コンテナは root で動くため、`backup/` 配下の出力は root 所有になる。事前に `mkdir -p backup` しておけばディレクトリ自体は実行ユーザー所有になり、未作成のまま実行すると Docker がマウント時に root 所有で作る

### 旧イメージでの実行

`0.3.0` 以前のイメージには `scripts/` が入っていないため、ホスト側のスクリプトを使い捨てコンテナへマウントして実行する(この場合はホストにスクリプトの実体が必要)。

```sh
docker compose run --rm \
  -v "$(pwd)/backup:/app/backup" \
  -v "$(pwd)/scripts/backup-s3.mjs:/app/backup-s3.mjs:ro" \
  --entrypoint node \
  devuntu /app/backup-s3.mjs
```

スクリプトは `/app/` 直下にマウントする。`WORKDIR` が `/app` なので出力先が `/app/backup` になり、`@aws-sdk/client-s3` も `/app/node_modules` から解決される。

## DBバックアップ

DB(`db`サービス)が起動している状態で実行する。`backup/`配下にタイムスタンプ付き(`.dump`/カスタム形式)で出力される。

```sh
pnpm db:backup
# または
./scripts/backup-db.sh
```

リポジトリを clone していない Docker 運用環境では、スクリプトと同じ内容を直接実行する。

```sh
mkdir -p backup
docker compose exec -T db pg_dump -U devuser -Fc devuntu \
  > backup/devuntu_$(date +%Y%m%d_%H%M%S).dump
```

ユーザー名と DB 名は `compose.yaml` の `POSTGRES_USER`/`POSTGRES_DB` に合わせる。

## DBリストア

対象のダンプファイルを引数に指定する。既存オブジェクトは削除された上で復元される。

```sh
pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
# または
./scripts/restore-db.sh backup/devuntu_YYYYMMDD_HHMMSS.dump
```

同じく、リポジトリを clone していない環境では直接実行する。既存 DB を作り直してから復元する(`--clean` ではダンプに含まれないテーブルと外部キーが残り、依存エラーになるため)。

アプリの停止が前提になる。`devuntu` は `restart: unless-stopped` のため、`dropdb -f` で切断してもすぐ接続を張り直して DROP が失敗する。復元後も Prisma の接続プールが古い状態を握るので、止めてから実行して最後に起動し直す。

```sh
docker compose stop devuntu

docker compose exec -T db dropdb -U devuser -f devuntu
docker compose exec -T db createdb -U devuser devuntu
docker compose exec -T db pg_restore -U devuser -d devuntu --no-owner --single-transaction \
  < backup/devuntu_YYYYMMDD_HHMMSS.dump

docker compose up -d devuntu
```

## S3バックアップ

アップロードされた画像はオブジェクトストレージ(`s3`サービス)にしか存在せず、Docker の名前付きボリューム`seaweeddata`が消えると復旧できない。DB だけ復元しても`Attachment`レコードや`link_widget.iconPath`、チケット本文の画像 URL が実体を失うため、**DB バックアップと対で取得する**。

S3 サービスが起動している状態で実行する。`.env`の`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`が必要。

```sh
pnpm s3:backup
# または
node ./scripts/backup-s3.mjs
```

S3 API 経由でオブジェクトを 1 件ずつ取得する論理バックアップで、SeaweedFS を停止せずに実行できる。`backup/`配下にタイムスタンプ付きのディレクトリが作られる。

```
backup/s3_YYYYMMDD_HHMMSS/
├── manifest.json  … キー・Content-Type・サイズ・ETag の一覧
└── objects/       … オブジェクト本体(ファイル名=オブジェクトキー)
```

一時ディレクトリへ書き出して成功時のみ本ディレクトリへ移動するため、途中で失敗しても欠けたバックアップは残らない。オブジェクトキーは`<uuidv7>.<拡張子>`のフラット構成のため、`/`を含むキーがあった場合は警告を出してスキップする。

`weed`の内部レイアウトに依存しないので、AWS S3 や Cloudflare R2 など他の S3 互換ストレージへ`S3_ENDPOINT`を向けて復元することもできる。

### Docker環境でのS3バックアップ

[`s3-tools`サービス](#s3-toolsサービス)の既定コマンドがバックアップなので、引数なしで実行する。

```sh
mkdir -p backup
docker compose run --rm s3-tools
```

`compose.yaml`と同じ階層の`backup/`に出力される。

## S3リストア

対象のバックアップディレクトリを引数に指定する。

```sh
pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
# または
node ./scripts/restore-s3.mjs backup/s3_YYYYMMDD_HHMMSS
```

バケット(`S3_BUCKET`、既定`devuntu`)は無ければ自動作成される。Content-Type は`manifest.json`の値で復元する。

**DB リストアと挙動が異なる点**として、バックアップに含まれるキーを上書きするだけで、**ストレージ側にしか無いオブジェクトは削除しない**。同じキーへ何度実行しても安全なので、DB リストアとセットで実行してよい。

### Docker環境でのS3リストア

[`s3-tools`サービス](#s3-toolsサービス)にリストアスクリプトとコンテナ内のパスを渡す。

```sh
docker compose run --rm s3-tools \
  /app/scripts/restore-s3.mjs /app/backup/s3_YYYYMMDD_HHMMSS
```

### ボリュームを作り直す場合

`seaweeddata`ボリュームを作り直すと`/data`のディスク消費をリセットできる。過去のバージョンで作られた volume ファイル(`*.dat`)は 1 ファイルあたり 1GiB を`fallocate`で先行確保しており、実データが数 KB でもディスクを 10GB 以上占有することがある(現行の`compose.yaml`の起動オプションでは先行確保は起きない)。

必ずバックアップを取ってから実行する。

```sh
pnpm s3:backup
pnpm db:backup

docker compose stop s3 && docker compose rm -f s3
docker volume rm devuntu_seaweeddata

docker compose up -d s3
pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
```

Docker 運用環境では `pnpm` の箇所を [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)・[Docker環境でのS3リストア](#docker環境でのs3リストア)・[DBバックアップ](#dbバックアップ)の直接実行コマンドに読み替える。

消費量は`docker compose exec -T s3 sh -c 'du -sk /data'`で確認できる。

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

## TypeScript v7 と v6 の併存

TypeScript 7.0 は JS コンパイラ API を同梱していない(7.1 で提供予定)ため、`require('typescript')`で API を使うツールが動かなくなる。[公式手順](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)に従い、`package.json`でエイリアスを使って両方を入れている。

| devDependencies の指定                           | 実体         | 提供するもの               |
| ------------------------------------------------ | ------------ | -------------------------- |
| `typescript: npm:@typescript/typescript6@^6.0.2` | TypeScript 6 | JS コンパイラ API と`tsc6` |
| `@typescript/native: npm:typescript@^7.0.2`      | TypeScript 7 | `tsc`                      |

TS6 の API を必要としているもの。

- `typescript-eslint`(`pnpm lint`) : TS7 を検出すると起動時にエラーで終了する
- `prettier-plugin-organize-imports` : TS7 だとエラーも出さずに import 整列が無効化される
- `next build`の型チェック : `next.config.ts`の`experimental.useTypeScriptCli: false`で JS API チェッカーを使う。既定の CLI チェッカーは解決した`typescript`パッケージの`bin.tsc`を実行するが、エイリアス先は`tsc6`しか持たないためビルドが止まる

TS7(tsgo)での高速な型チェックは下記で行う。`tsconfig.json`が`.next/dev/types`を含むため、先に`next typegen`でルート型を生成している。

```sh
pnpm typecheck
```

TS 7.1 で JS API が復活し typescript-eslint が対応したら、`typescript`を素の`^7.x`に戻して`@typescript/native`と`useTypeScriptCli: false`は削除できる。

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
