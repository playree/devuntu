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

## tsxでのコメント

わざわざ{}は使わず、下記のようにタグ内にコメントを記載する

```
<Link // コメント
  href='./test'
>
```

複数行の場合

```
<Link
  /**
   * 複数行
   * の場合
   */
  href='./test'
>
```

# ロケールの構成ファイル

- src/locale/index.ts
- src/locale/lang-ja.ts
- src/locale/lang-en.ts

# コードレビュー除外ファイル

- `src/generated/**`
- `prisma/migrations/**`
