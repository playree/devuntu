- [Devuntu](#devuntu)
  - [できること](#できること)
  - [設計・開発方針](#設計開発方針)
- [導入者向け](#導入者向け)
  - [構成](#構成)
  - [導入の流れ](#導入の流れ)
  - [外部サービス連携](#外部サービス連携)
  - [運用](#運用)
  - [環境変数](#環境変数)
- [利用者向け](#利用者向け)
  - [ボードとチケット](#ボードとチケット)
  - [カレンダーと空き時間の共有](#カレンダーと空き時間の共有)
  - [通知](#通知)
  - [AIとの連携](#aiとの連携)
- [開発者向け](#開発者向け)
  - [パッケージ構成](#パッケージ構成)
  - [開発環境](#開発環境)
  - [画面とアクセス制御](#画面とアクセス制御)
  - [テスト・Lint](#テストlint)

# Devuntu

Devuntu は、かんばん形式のボード/チケット管理を中心に、カレンダー連携・メール/Slack通知・MCP/AIエージェント連携などを備えた
セルフホスト型のプロジェクト管理ツールです。

## できること

- かんばんとチケット管理(ボード、タグ、担当者、優先度、期日、コメント、メンション)
- Googleカレンダー連携と、認証不要な公開URLでの空き時間共有
- メンションのメール / Slack DM 通知
- MCP サーバーとしての公開。Claude Code などから自分の権限でチケットを操作できる
- AIエージェントへのチケット委任。担当エージェントが Claude Code を自動起動して対応する

## 設計・開発方針

- できるだけシンプルな機能やUIに
- できるだけ最新のライブラリやフレームワークを利用
- できるだけアップデートを続ける

# 導入者向け

## 構成

Docker Compose で3つのサービスを起動します(`compose.yaml`)。

| サービス  | 役割                                |
| --------- | ----------------------------------- |
| `devuntu` | アプリ本体(Next.js)                 |
| `db`      | PostgreSQL                          |
| `s3`      | アップロード画像の保存先(SeaweedFS) |

## 導入の流れ

1. `compose.yaml` と `docker/seaweedfs-s3.json` をホストへ配置する
2. `.env.docker` を作る(`BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` / `DATABASE_URL` / メール / S3)
3. `docker compose up -d` で起動する(DBマイグレーションは起動時に自動実行)
4. `<BETTER_AUTH_URL>/start` を開いて最初の管理者を登録する
5. 必要に応じて Google / Slack / MCP / AIエージェントの連携を設定する

手順の詳細と注意点は [docs/installation.md](docs/installation.md) を参照。

## 外部サービス連携

いずれも環境変数の設定が前提で、Google と Slack は管理者が `/admin/settings` で有効化します。

| 連携           | 前提                                               | 有効にすると                            |
| -------------- | -------------------------------------------------- | --------------------------------------- |
| メール         | `MAIL_SEND` / `MAIL_FROM`                          | メールOTPでのサインインとメンション通知 |
| Google         | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`        | Googleサインインとカレンダー機能        |
| Slack          | `SLACK_*` 一式                                     | Slack DM 通知とチケットURLの展開        |
| MCP            | `OIDC_DCR_ENABLED=true`                            | MCPクライアントからの接続               |
| AIエージェント | `/admin/agents` でのエージェント作成とトークン発行 | エージェントによるチケットの自動処理    |

## 運用

DB とアップロード画像は別々に保存されるため、バックアップは**必ず対で取得**します。
手順・リストア・定期実行は [docs/operations.md](docs/operations.md) を参照。

アップデートは `docker compose pull && docker compose up -d`。マイグレーションは起動時に自動適用されます。

## 環境変数

環境変数の一覧は [docs/environment-variables.md](docs/environment-variables.md) を参照。

# 利用者向け

画面の使い方は [docs/user-guide.md](docs/user-guide.md) にまとめています。

## ボードとチケット

かんばん(バックログ / 対応予定 / 対応中 / 完了)でチケットを管理します。
ボードにはボードキーがあり、チケットは `ABC-42` のような表示IDで参照できます(`/t/ABC-42`)。

ボードはチームで共有するもののほか、1ユーザーにつき1つのプライベートボードが自動で用意されます。

## カレンダーと空き時間の共有

Googleアカウントと連携すると、`/cal` で自分の予定を確認できます。
「空き時間の共有」を有効にすると**認証不要の公開URL**が発行され、予定の詳細を見せずに空き状況だけを共有できます。

## 通知

チケット本文・コメントで `@` によりメンションされたユーザーへ、**メール**または**Slack DM**で通知します。
通知の ON/OFF はイベント種別 × チャネルごとに `/account` の「通知設定」から切り替えられます。

Slack 通知を利用するには、管理者による連携の有効化と、利用者本人の Slack アカウント連携が必要です。
また Slack に貼られたチケットURLは、閲覧権限を確認した上でカード表示に展開されます。

実装の詳細や Slack App の設定手順は [docs/notifications.md](docs/notifications.md) を参照。

## AIとの連携

- **MCPクライアントから使う** — `/api/mcp` へ接続すると、自分の権限でチケットの検索・作成・更新ができます。
  登録手順と仕組みは [docs/mcp-server.md](docs/mcp-server.md) を参照
- **エージェントに任せる** — エージェントを担当者にし、チケットの「エージェントモード」を選ぶと、
  利用者のマシンで Claude Code が自動起動して対応します。プランを先に投稿させることもできます。
  仕組みは [docs/agent-runner.md](docs/agent-runner.md) を参照
- **承認** — 自分が承認者になっているエージェントのチケットは `/agents` からまとめて確認・許可できます

# 開発者向け

## パッケージ構成

- Next.js v16
- TypeScript v7(v6 と併存。詳細は[docs/development.md](docs/development.md#typescript-v7-と-v6-の併存)を参照)
- pnpm v11
- Prisma v7
- Better Auth v1.7
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

## 開発環境

開発環境のセットアップ、ビルド、パッケージ管理、イメージ作成などの手順は
[docs/development.md](docs/development.md) を参照。

## 画面とアクセス制御

画面一覧とアクセス制御の実装、および API のアクセス制御は [docs/screens.md](docs/screens.md) を参照。

## テスト・Lint

```sh
pnpm test       # vitest
pnpm lint       # eslint
pnpm typecheck  # tsgo
pnpm build      # ビルド確認
```

コーディングルールは [CLAUDE.md](CLAUDE.md) を参照。
