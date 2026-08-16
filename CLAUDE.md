# 動作

- 回答は日本語でお願い

# プロジェクト概要

- Next.js v16
- pnpm v11
- Prisma v7
- Better Auth v1.6
- Tailwind CSS v4
- HeroUI v3
- Zod v4
- next-safe-action v8

# コーディングルール

- コンポーネントは`src/components`配下に配置し、まずは既存の部品を利用できないか検討する
- 外部ライブラリを追加する場合は事前に確認する
- if文は必ず{}を利用する
- Util系は`src/lib`配下に配置し、まずは既存のUtilを利用できないか検討する
- 環境変数の参照は`src/lib/env-util.ts`を利用する
- Server Actionsは基本的に利用するClientファイルと同じ階層の`server.ts`に配置する
- `src/components/general`配下は共通部品として独立させたいので、このフォルダ内で完結するようにする
- テストソースは`tests`配下に配置する
- better-authをバージョンアップする場合には、ライブラリが要求するテーブル定義に変更が無いかをチェックする
- コンパイル、ビルド確認は`pnpm build`
- 修正ファイルには`pnpm exec prettier --write`を実施する
- classNameの外部定義はなるべく`tailwind-variants`を利用する
- 1ファイルが肥大化しないように考慮する
- コメントにはコードから復元可能な内容は書かない。変更履歴としての内容も不要。
- ソースやテストに個人情報(氏名やメアド)を利用しない

## tsxでのコメント

わざわざ{}は使わず、下記のようにタグ内にコメントを記載する

```tsx
<Link // コメント
  href='./test'
>
```

複数行の場合

```tsx
<Link
  /**
   * 複数行
   * の場合
   */
  href='./test'
>
```

# 画面の動作確認

- 画面の動作確認は必要最低限とする。軽微な修正では不要。
- 画面の表示・動作確認はスキル `screen-check`(`.claude/skills/screen-check/SKILL.md`)の手順に従う
- ブラウザ操作は Playwright MCP(`.mcp.json` の `playwright`)経由。ヘッドレスのみ(DISPLAY 無し)
- 開発サーバーは必ず `http://localhost:3000`。`BETTER_AUTH_URL` が localhost:3000 固定のため、別ポートでは認証の POST が origin チェックで 403 になる
- 既に `pnpm dev` が起動している場合は再利用し、再起動しない。自分で起動した場合は確認が終わったら停止する
- ログインはメールOTP。OTP は `verification` テーブル(`sign-in-otp-<小文字メール>`)から取得する
- 開発DBは実データなので、指示が無い限り画面から作成・更新・削除の操作はしない
- 開発サーバーのログは `.work/dev-server.log`、スクリーンショットは `.work/playwright` に出力する

# ロケールの構成ファイル

- src/locale/index.ts
- src/locale/lang-ja.ts
- src/locale/lang-en.ts

# コードレビュー除外ファイル

- `src/generated/**`
- `prisma/migrations/**`

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
