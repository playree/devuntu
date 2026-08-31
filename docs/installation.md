- [前提](#前提)
- [構成](#構成)
- [1. compose.yaml の配置](#1-composeyaml-の配置)
- [2. 環境変数ファイルの作成](#2-環境変数ファイルの作成)
- [3. 起動](#3-起動)
- [4. 初期セットアップ(最初の管理者を作る)](#4-初期セットアップ最初の管理者を作る)
- [5. サインインの確認](#5-サインインの確認)
- [外部サービス連携(任意)](#外部サービス連携任意)
  - [Googleアカウント連携](#googleアカウント連携)
  - [Slack連携](#slack連携)
  - [MCP サーバーの公開](#mcp-サーバーの公開)
  - [AIエージェント](#aiエージェント)
- [アップデート](#アップデート)
- [困ったとき](#困ったとき)

# 導入(セルフホスト)

Docker Compose で Devuntu を立ち上げるまでの手順。運用開始後のバックアップ手順は
[operations.md](operations.md)、開発環境の構築は [development.md](development.md) を参照。

## 前提

- Docker / Docker Compose が動くホスト
- 利用者に見せる URL を決めてあること(`BETTER_AUTH_URL` に設定する)
- **メール送信手段**。既定の構成(`DISABLE_PASSWORD_AUTH=true`)ではメールOTPがサインインの唯一の手段になるため、
  SendGrid / sendmail / SMTP のいずれかを用意する。試用のみであれば `MAIL_SEND=debug` でサーバーログに
  OTP を出力させることもできる

## 構成

`compose.yaml` は3つのサービスを定義している。

| サービス  | イメージ                 | 役割                             | 公開ポート |
| --------- | ------------------------ | -------------------------------- | ---------- |
| `devuntu` | `playree/devuntu:latest` | アプリ本体(Next.js)              | 3000       |
| `db`      | `postgres:18`            | データベース                     | 5432       |
| `s3`      | `chrislusf/seaweedfs`    | アップロード画像の保存先(S3互換) | 8333       |

`s3-tools` はバックアップ用の使い捨てサービスで、`profiles: ['tools']` が付いているため
`docker compose up` では起動しない([operations.md](operations.md#s3-toolsサービス))。

永続データは名前付きボリューム `pgdata` / `seaweeddata` に入る。

## 1. compose.yaml の配置

任意のディレクトリ(例: `/opt/devuntu`)に、このリポジトリの `compose.yaml` と
`docker/seaweedfs-s3.json` を同じ相対パスで置く。アプリはイメージから起動するため、
リポジトリ全体の clone は不要。

```text
/opt/devuntu/
├── compose.yaml
├── .env.docker
└── docker/
    └── seaweedfs-s3.json
```

`docker/seaweedfs-s3.json` は S3 のアクセスキーを定義するファイル。後述の
`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` と値を揃える。

## 2. 環境変数ファイルの作成

`compose.yaml` と同じ階層に `.env.docker` を作る。最小構成は次のとおり。

```sh
# 基本
DEFAULT_LOCALE=ja
DEFAULT_TIMEZONE=Asia/Tokyo
DATABASE_URL=postgresql://devuser:<DBパスワード>@db:5432/devuntu?schema=public

# 認証
BETTER_AUTH_URL=https://devuntu.example.com
BETTER_AUTH_SECRET=<openssl rand -base64 32 の出力>
DISABLE_PASSWORD_AUTH=true

# メール(メールOTPのサインインに必要)
MAIL_SEND=smtp
MAIL_FROM=devuntu@example.com
SMTP_HOST=<SMTPホスト>
SMTP_PORT=25

# オブジェクトストレージ
S3_ENDPOINT=http://s3:8333
S3_BUCKET=devuntu
S3_ACCESS_KEY_ID=<アクセスキー>
S3_SECRET_ACCESS_KEY=<シークレットキー>
```

全変数の一覧とデフォルト値は [environment-variables.md](environment-variables.md) を参照。

設定時の注意点。

- **`BETTER_AUTH_URL` は実際に配信するオリジンと完全に一致させる。** 不一致だとサインインなどの
  POST が origin チェックで拒否される
- `BETTER_AUTH_SECRET` は必ず自前で生成する(`openssl rand -base64 32`)
- `compose.yaml` の `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` と `DATABASE_URL` を揃える。
  **リポジトリ既定の `devuser` / `devPassW0rd` は開発用なので本番では必ず変更する**
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` は `docker/seaweedfs-s3.json` の内容と揃える。
  バケットは初回アップロード時に自動作成されるため事前作業は不要
- `DISABLE_PASSWORD_AUTH=false`(パスワード認証あり)にする場合、既定の `TWO_FA_REQUIRED=true` により
  2要素認証の設定が必須になる。挙動は [screens.md](screens.md#アクセス制御の仕組み) を参照

## 3. 起動

```sh
docker compose up -d
```

`db` と `s3` の healthcheck が通ってから `devuntu` が起動する。
DB マイグレーションは `docker/docker-entrypoint.sh` が起動時に `prisma migrate deploy` を実行するため、
**手動でのマイグレーションは不要**(アップデート時も同じ)。

起動を確認する。

```sh
docker compose logs -f devuntu
curl -s http://localhost:3000/api/health
# => {"status":"ok","timestamp":"..."}
```

## 4. 初期セットアップ(最初の管理者を作る)

ブラウザで `<BETTER_AUTH_URL>/start` を開き、最初の管理者を登録する。

- この画面はユーザーが1人も居ないときだけ開ける。1人でも登録されると `/` へリダイレクトされ、
  以後は使えない。**起動したらまず実施する**
- 入力するのは名前とメールアドレス。`DISABLE_PASSWORD_AUTH=false` の場合のみパスワード欄も表示される
- 以後のユーザー追加は管理者が `/admin/users` から行う

## 5. サインインの確認

`<BETTER_AUTH_URL>/auth/signin` から、登録したメールアドレスでOTPサインインできることを確認する。

メールが届かない場合は `MAIL_SEND` 周りの設定を見直す。`MAIL_SEND=debug` にしていると
実際には送信されず、OTP はサーバーログ(`docker compose logs devuntu`)に出力される。

## 外部サービス連携(任意)

いずれも環境変数を設定して `devuntu` を再起動したうえで、管理者が `/admin/settings` で有効化する。

### Googleアカウント連携

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (必要に応じて `GOOGLE_ALLOWED_DOMAINS`)を設定する。
Google 側のコールバックURLには `<BETTER_AUTH_URL>/api/auth/callback/google` を登録する。

**カレンダー機能(`/cal`)は Google アカウント連携が前提**で、未連携のユーザーには案内だけが表示される。

### Slack連携

`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_BOT_TOKEN` / `SLACK_TEAM_ID` / `SLACK_SIGNING_SECRET`
を設定する。Slack App のマニフェストは `slack/manifest.yaml`。

メンションの Slack DM 通知と、Slack に貼られたチケットURLの展開が使えるようになる。
手順の詳細は [notifications.md](notifications.md#slack通知の前提) を参照。

### MCP サーバーの公開

`OIDC_DCR_ENABLED=true` を設定すると、Claude Code などの MCP クライアントが
`<BETTER_AUTH_URL>/api/mcp` へ動的クライアント登録(DCR)で接続できるようになる。
詳細と運用上の注意は [mcp-server.md](mcp-server.md) を参照。

### AIエージェント

管理者が `/admin/agents` からエージェントユーザーを作り、接続用の長期トークンを発行する。
利用者のマシンで Claude Code を自動起動させる仕組みは [agent-runner.md](agent-runner.md) を参照。

## アップデート

```sh
docker compose pull
docker compose up -d
```

新しいイメージで起動する際、entrypoint が `prisma migrate deploy` を実行して DB を追随させる。
**アップデート前にバックアップを取得する**こと([operations.md](operations.md))。

## 困ったとき

| 症状                                     | 見るところ                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| アプリが起動しない                       | `docker compose logs devuntu`。マイグレーション失敗なら `DATABASE_URL` と `db` の状態     |
| サインインの操作が失敗する               | `BETTER_AUTH_URL` が実際のオリジンと一致しているか                                        |
| `/start` が `/` へリダイレクトされる     | 既にユーザーが登録済み。`/auth/signin` からサインインする                                 |
| OTP メールが届かない                     | `MAIL_SEND` / `MAIL_FROM` と送信手段の設定。`debug` の場合はログに出力される              |
| 画像がアップロードできない・表示されない | `s3` サービスの状態と `S3_*` の設定、`docker/seaweedfs-s3.json` との突き合わせ            |
| カレンダーが使えない                     | Googleアカウント連携が有効か(`/admin/settings`)、利用者本人が `/account` で連携しているか |
