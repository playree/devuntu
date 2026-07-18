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

- コンポーネントは`src/components`配下に配置
- 外部ライブラリを追加する場合は事前に確認する
- if文は必ず{}を利用する
- Util系は`src/lib`配下に配置
- 環境変数の参照は`src/lib/env-util.ts`を利用する
- Server Actionsは基本的に利用するClientファイルと同じ階層の`server.ts`に配置する
- `src/components/general`配下は共通部品として独立させたいので、このフォルダ内で完結するようにする

# ロケールの構成ファイル

- src/locale/index.ts
- src/locale/lang-ja.ts
- src/locale/lang-en.ts

# 自動実行

- コンパイル確認は不要
- 参照系bash commandは実行を許可
- 修正ファイルには`pnpm exec prettier --write`を実施する
- CLAUDE.mdに追記した方が良い内容があれば提案して
- Plan作成時のMDファイルは`.plan`配下に作成して

# コードレビュー除外ファイル

- `src/generated/**`
- `prisma/migrations/**`
