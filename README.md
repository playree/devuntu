- [Devuntu](#devuntu)
- [パッケージ構成](#パッケージ構成)
- [画面一覧](#画面一覧)
  - [一般](#一般)
  - [タスク管理](#タスク管理)
  - [管理者](#管理者)
  - [認証・公開](#認証公開)
- [MCP サーバー](#mcp-サーバー)
  - [Claude Code への登録](#claude-code-への登録)
- [AIエージェント](#aiエージェント)
  - [Claude Code への登録(エージェント)](#claude-code-への登録エージェント)
  - [自動運用(Devuntu Agent)](#自動運用devuntu-agent)
- [通知](#通知)
- [環境変数](#環境変数)
- [開発](#開発)

# Devuntu

Devuntu は、かんばん形式のボード/チケット管理を中心に、カレンダー連携・メール/Slack通知・MCP連携などを備えた
セルフホスト型のプロジェクト管理ツールです。

# パッケージ構成

- Next.js v16
- TypeScript v7(v6 と併存。詳細は[開発](#開発)を参照)
- pnpm v11
- Prisma v7
- Better Auth v1.7
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

# 画面一覧

## 一般

| 画面名称       | パス       |
| -------------- | ---------- |
| ダッシュボード | `/`        |
| カレンダー     | `/cal`     |
| アカウント     | `/account` |

## タスク管理

| 画面名称               | パス                    |
| ---------------------- | ----------------------- |
| ボード一覧             | `/boards`               |
| かんばん               | `/boards/[id]`          |
| ボード設定             | `/boards/[id]/settings` |
| チケット一覧           | `/tickets`              |
| チケット詳細           | `/tickets/[id]`         |
| チケット表示IDでの参照 | `/t/[displayId]`        |

## 管理者

管理者(`role === 'admin'`)のみアクセスできる画面。

| 画面名称           | パス                  |
| ------------------ | --------------------- |
| ユーザー管理       | `/admin/users`        |
| エージェント管理   | `/admin/agents`       |
| グループ管理       | `/admin/groups`       |
| ダッシュボード管理 | `/admin/dashboard`    |
| 設定(連携設定)     | `/admin/settings`     |
| OIDCクライアント   | `/admin/oidc-clients` |

## 認証・公開

| 画面名称         | パス           | 補足                                        |
| ---------------- | -------------- | ------------------------------------------- |
| サインイン       | `/auth/signin` | メールOTPによるサインイン                   |
| 初期セットアップ | `/start`       | 初回のみ                                    |
| 空き時間の共有   | `/cal/[id]`    | **認証不要の公開ページ**。共有URLで参照する |

各画面のアクセス制御の実装詳細、および API のアクセス制御は
[docs/screens.md](docs/screens.md) を参照。

# MCP サーバー

`/api/mcp` を MCP クライアント(Claude Code / VS Code など)へ公開しており、Devuntu 自身が認可サーバーを
兼ねるため、クライアントは接続時に動的クライアント登録(DCR)→ 認可コードフローの順で進みます。
利用するには管理者が `OIDC_DCR_ENABLED=true` を設定している必要があります。

登録しただけではデータは読めず、devuntu へのログインと同意が必要です。詳しい仕組みや運用上の注意は
[docs/mcp-server.md](docs/mcp-server.md) を参照。

ブラウザを持たない**AIエージェント**は認可コードフローを踏めないため、管理画面で発行する
長期トークンで接続します(後述)。

## Claude Code への登録

```sh
claude mcp add --transport http devuntu <BETTER_AUTH_URL>/api/mcp
```

ユーザースコープで登録する場合

```sh
claude mcp add --scope user --transport http devuntu <BETTER_AUTH_URL>/api/mcp
```

登録後、devuntu のツールを最初に呼び出したタイミングでブラウザが開き、DCR → 認可コードフロー(PKCE)
が始まります。ログインしていない場合はログインし、続く同意画面で許可すれば以降はリフレッシュトークンで
自動的に継続します。

- 登録状況は `claude mcp list`、削除は `claude mcp remove devuntu`
- 許可の取り消しは `/account` の「許可済みアプリ」から行えます

# AIエージェント

Web ログインを行わず、MCP からのみ Devuntu を利用するユーザーです。管理者が
[`/admin/agents`](docs/screens.md) から作成し、接続用の長期トークンを発行します。

- メールアドレスは入力した識別子から `<識別子>@agents.invalid` として自動生成されます。
  `.invalid` は予約ドメインなのでメールは届かず、作成後に識別子は変更できません
- ボードやチケットの権限は人間の利用者と同じです。ボードのメンバーに加えれば担当者として選択でき、
  メンションの宛先にもなります
- トークンは1エージェントにつき1本です。発行時に一度だけ表示され、既定は無期限で任意の期限も選べます
- 再発行すると前のトークンは即座に使えなくなります。最終利用日時は一覧から確認できます

## Claude Code への登録(エージェント)

発行時に表示されるコマンドをそのまま使えます。

```sh
claude mcp add --transport http devuntu-agent <BETTER_AUTH_URL>/api/mcp \
  --header "Authorization: Bearer <発行したトークン>"
```

この経路ではブラウザでのログインと同意は発生しません。

## 自動運用(Devuntu Agent)

エージェントに担当チケットを任せると、利用者のマシンで **Claude Code が自動的に起動して処理**します。
常駐プロセスは作らず、cron が 5 分おきに単発のランナー(Python・標準ライブラリのみ)を起動し、
処理すべきチケットがあるときだけ Claude Code を立ち上げます。

- チケットの処理方式はチケットごとに選べます
  - **プラン先行**: プランをコメントで投稿して一旦終了し、返信を受けてから実装に進みます
  - **自動実行**: プランを作らずに対応して結果を報告します
- 担当を割り当てただけでは動きません。チケット詳細で処理方式を指定したものだけが対象です
- 稼働の有効/無効、稼働許可時間帯(夜間のみ動かすなど)、処理の前後に読ませる指示は
  `/admin/agents` の「自動運用」から設定します。稼働状況と実行履歴も同じ画面で確認できます

セットアップは Claude Code から「devuntu のエージェントをセットアップして」と頼めば、
MCP ツール `get_agent_setup_guide` が返す手順に沿って進みます。
仕組みの詳細は [docs/agent-runner.md](docs/agent-runner.md) を参照。

# 通知

チケット本文・コメントで `@` によりメンションされたユーザーへ、**メール**または**Slack DM**で通知します。
通知の ON/OFF はイベント種別 × チャネルごとに `/account` の「通知設定」から切り替えられます。

Slack 通知を利用するには、管理者による連携の有効化と、利用者本人の Slack アカウント連携が必要です。
また Slack に貼られたチケットURLは、閲覧権限を確認した上でカード表示に展開されます。

実装の詳細や Slack App の設定手順は [docs/notifications.md](docs/notifications.md) を参照。

# 環境変数

環境変数の一覧は [docs/environment-variables.md](docs/environment-variables.md) を参照。

# 開発

開発環境のセットアップ、DB/S3のバックアップ・リストア、ビルド、パッケージ管理、イメージ作成などの
手順は [docs/development.md](docs/development.md) を参照。
