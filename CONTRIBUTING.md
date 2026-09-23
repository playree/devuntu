# コントリビューションガイド

> [!NOTE]
> Contributions are welcome in English as well. The documentation is maintained in Japanese only.

Devuntu への Issue・Pull Request を歓迎します。

脆弱性は公開の Issue にせず、[SECURITY.md](SECURITY.md) の手順で非公開に報告してください。

## Issue

- バグ報告・機能要望は Issue のテンプレートから作成してください
- 大きな変更や外部ライブラリの追加を伴うものは、Pull Request の前に Issue で相談してください

## 開発環境

セットアップ・ビルド・パッケージ管理の手順は [docs/development.md](docs/development.md) を参照してください。
画面とアクセス制御の一覧は [docs/screens.md](docs/screens.md) にあります。

## ブランチ

- `main` から切って、`main` へ Pull Request を出します
- Devuntu のチケットに対応する場合は、チケットIDをブランチ名にします(例: `feature/DEVUNTU-1`)
- チケットが無い場合は `feature/<内容>` / `fix/<内容>` のように内容が分かる名前にします

## コミット

- 変更内容を日本語で1行にまとめます
- チケットに対応する場合は末尾にチケットIDを付けます(例: `通知設定の保存に失敗する問題を修正 (DEVUNTU-1)`)
- コミットと Pull Request には、個人情報(氏名やメールアドレス)やURLを含めないでください

## Pull Request

- 内容は箇条書き程度に簡潔にまとめます
- 出す前に、以下が通ることを確認してください(CI でも同じものを実行します)

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- 修正したファイルには `pnpm exec prettier --write <ファイル>` をかけてください
- 機能や仕様を変えた場合は、対応するドキュメント(`README.md` / `docs/*.md`)も更新してください

## コーディングルール

- コンポーネントは`src/components`配下に配置し、まずは既存の部品を利用できないか検討する
- `MultiButton`のアイコンは`children`ではなく`icon`に指定する(`isPending`時のSpinner切替が効かなくなる為)
- 外部ライブラリを追加する場合は事前に確認する
- if文は必ず{}を利用する
- Util系は`src/lib`配下に配置し、まずは既存のUtilを利用できないか検討する
- `src/lib`配下でファイル数が増えたドメインは、接頭辞が共通する、または相互に強く依存するファイル群をサブディレクトリにまとめる(例: `agent-*.ts` → `agent/`)。ファイル名は変更しない
- 汎用的で複数ドメインから参照される基盤ユーティリティ(day, logger, error, env-util等)や、単体で完結するファイルはトップレベルに残し、「utils」的な寄せ集めフォルダは作らない
- 環境変数の参照は`src/lib/env-util.ts`を利用する
- Server Actionsは基本的に利用するClientファイルと同じ階層の`server.ts`に配置する
- `src/components/general`配下は共通部品として独立させたいので、このフォルダ内で完結するようにする
- テストソースは`tests`配下に配置する
- better-authをバージョンアップする場合には、ライブラリが要求するテーブル定義に変更が無いかをチェックする
- コンパイル、ビルド確認は`pnpm build`
- ソース修正後には`pnpm lint`と`pnpm typecheck`を実施する
- 修正ファイルには`pnpm exec prettier --write`を実施する
- classNameの外部定義はなるべく`tailwind-variants`を利用する
- 1ファイルが肥大化しないように考慮する
- コメントにはコードから復元可能な内容は書かない。変更履歴としての内容も不要。
- ソースやテストに個人情報(氏名やメアド)を利用しない
- `public/agent/devuntu_agent.py`を更新したら、中に定義されている`__version__`のバージョン情報をインクリメントすること
- UIはスマホレイアウトも考慮する
- `schema.prisma`を更新したら、`pnpm generate`を行うこと。

### tsxでのコメント

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
