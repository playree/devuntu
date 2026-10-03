# 基本ルール

- 会話は日本語でお願い

# プロジェクト概要

かんばん形式のボード/チケット管理を中心に、カレンダー連携・通知(メール / Slack / Webプッシュ)・
MCPサーバー・AIエージェント連携を備えたセルフホスト型のプロジェクト管理ツール。

- Node.js v24
- Next.js v16
- TypeScript v7(TypeScript v6 と併存)
- pnpm v12
- Prisma v7
- Better Auth v1.7
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

## ドキュメント

機能や仕様を調べるとき・変更したときは、対応するドキュメントを参照して更新する。

docs は読者別に `guide/`(利用者)・`admin/`(運用者)・`dev/`(開発者)へ分けている。入口は [docs/README.md](docs/README.md)。

| ファイル                                                                   | 内容                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| [README.md](README.md)                                                     | 全体の入口。各ドキュメントへの索引                       |
| [README.en.md](README.en.md)                                               | 英語の README(概要・クイックスタート)                    |
| [docs/README.md](docs/README.md)                                           | ドキュメントの入口(読者別の案内)                         |
| [docs/guide/getting-started.md](docs/guide/getting-started.md)             | はじめに(最初の30分・用語・役割と権限・FAQ)(利用者向け)  |
| [docs/guide/user-guide.md](docs/guide/user-guide.md)                       | 画面ごとの使い方(利用者向け)                             |
| [docs/guide/ai.md](docs/guide/ai.md)                                       | MCP のつなぎ方・エージェントへの任せ方・承認(利用者向け) |
| [docs/admin/README.md](docs/admin/README.md)                               | 導入後にやること・管理者の画面(運用者向け)               |
| [docs/admin/installation.md](docs/admin/installation.md)                   | セルフホストの導入手順・HTTPS 化(運用者向け)             |
| [docs/admin/operations.md](docs/admin/operations.md)                       | バックアップ/リストア・メンテナンス(運用者向け)          |
| [docs/admin/environment-variables.md](docs/admin/environment-variables.md) | 環境変数の早見表と一覧(運用者向け)                       |
| [docs/admin/notifications.md](docs/admin/notifications.md)                 | 通知の設定・Slack App(運用者向け)                        |
| [docs/admin/git-integration.md](docs/admin/git-integration.md)             | GitHub / GitLab 連携の Webhook 設定(運用者向け)          |
| [docs/admin/mcp-server.md](docs/admin/mcp-server.md)                       | MCPサーバーの公開設定・トークンの運用(運用者向け)        |
| [docs/admin/agent-runner.md](docs/admin/agent-runner.md)                   | AIエージェントの自動運用の設置・設定(運用者向け)         |
| [docs/admin/command-exec.md](docs/admin/command-exec.md)                   | リモート実行の定義・SSH・権限(運用者向け)                |
| [docs/dev/README.md](docs/dev/README.md)                                   | 開発者向けドキュメントの一覧                             |
| [docs/dev/development.md](docs/dev/development.md)                         | 開発環境・ビルド・パッケージ管理(開発者向け)             |
| [docs/dev/screens.md](docs/dev/screens.md)                                 | 画面・APIの一覧とアクセス制御(開発者向け)                |
| [docs/dev/mcp-tools.md](docs/dev/mcp-tools.md)                             | MCPツールの一覧・権限・画像添付 API(開発者向け)          |
| [docs/dev/operations-internals.md](docs/dev/operations-internals.md)       | バックアップ・メンテナンスの仕組み(開発者向け)           |
| [docs/dev/notifications-internals.md](docs/dev/notifications-internals.md) | 通知(キュー・トリガー・チャネル)の仕組み(開発者向け)     |
| [docs/dev/mcp-server-internals.md](docs/dev/mcp-server-internals.md)       | MCPサーバーの認証・入力仕様の実装(開発者向け)            |
| [docs/dev/agent-runner-internals.md](docs/dev/agent-runner-internals.md)   | AIエージェントの自動運用の仕組み(開発者向け)             |
| [docs/dev/command-exec-internals.md](docs/dev/command-exec-internals.md)   | リモート実行の実装上の決めごと(開発者向け)               |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                         | 開発規約(ブランチ・コミット・PR・コーディングルール)     |
| [SECURITY.md](SECURITY.md)                                                 | 脆弱性の報告方法                                         |

# 開発規約

ブランチ・コミット・PR・コーディングルールは CONTRIBUTING.md にまとめている。

@CONTRIBUTING.md

# 画面の動作確認

- 画面の動作確認は必要最低限とする。軽微な修正では不要。
- 画面の表示・動作確認はスキル `screen-check`(`.claude/skills/screen-check/SKILL.md`)の手順に従う
- ブラウザ操作は Playwright MCP(`.mcp.json` の `playwright`)経由。ヘッドレスのみ(DISPLAY 無し)
- 開発サーバーは必ず `http://localhost:3000`。`BETTER_AUTH_URL` が localhost:3000 固定のため、別ポートでは認証の POST が origin チェックで 403 になる
- 既に `pnpm dev` が起動している場合は再利用し、再起動しない。自分で起動した場合は確認が終わったら停止する
- ログインはメールOTP。OTP は `verification` テーブル(`sign-in-otp-<小文字メール>`)から取得する
- 開発サーバーのログは `.work/dev-server.log`、スクリーンショットは `.work/playwright` に出力する

# ロケールの構成ファイル

- src/locale/index.ts
- src/locale/lang-ja.ts
- src/locale/lang-en.ts

# コードレビュー除外ファイル

`.coderabbit.yaml` の `path_filters` と揃える。

- `src/generated/**`
- `prisma/migrations/**`
- `**/*.lock`

# MCPサーバーの使い分け(本番/開発)

- 本番devuntuのチケット操作は`mcp__devuntu__*`、開発環境の動作確認は`mcp__devuntu-dev__*`を使う
- チケットがURLの場合は、originが`http://localhost:3000`と完全一致する場合のみ開発環境と判断する。別ポートやポート無し、その他のoriginは本番環境として扱う
- 指示に「本番」「開発」の指定が無い場合は、本番を対象とする

# devuntuチケット対応時のコメント運用

- devuntuのチケットをインプットに対応を行う場合、MCPツールを使い以下のタイミングでコメントやステータス変更をする(都度の確認は不要、自動で投稿する)
  - 対応開始時: 該当チケットのステータスを対応中にする
  - プラン作成後: 該当チケットに`type: "plan"`でプラン内容をコメントする
  - 対応完了後: 該当チケットに`type: "report"`で対応報告(何をしたか、確認結果、スクリーンショットなど)をコメントする
- 使用するMCPサーバーは対応対象チケットの本番/開発環境に合わせる(上記の使い分けルールに従う)
- `ticketId`には表示ID(例: ABC-42)を指定する
- 検証でスクリーンショットを取得した場合は、reportの投稿に含めてアップロードする

# PR作成前のセルフレビュー

- PRを作成する前に、スキル `code-review` で main との差分をセルフレビューする
- 指摘は修正するか、修正しない理由を判断してから PR を出す。修正しなかった指摘とその理由は PR 本文に書く
- セルフレビューで修正した場合は、`pnpm lint` / `pnpm typecheck` / `pnpm test` を再実行してから PR を出す
- コードレビュー除外ファイル(上記)は対象外とする

# PRレビューへの返信

- レビュー指摘に対する返信は、**対応内容をコミットしてリモートへプッシュした後**に行う
  - レビューツール(CodeRabbit等)はリモートの状態を見るため、作業ツリーを直しただけで「修正しました」と返信すると事実と食い違う
  - 「コミット済みだが未プッシュ」も同様にNG
- 修正しない指摘への反論や質問への回答も、作業ツリーに未反映の変更が残っている状態では行わない(先にコミット&プッシュするか、変更を退避する)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
