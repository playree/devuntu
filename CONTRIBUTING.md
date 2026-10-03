# コントリビューションガイド

> [!NOTE]
> Contributions are welcome in English as well. The documentation is maintained in Japanese only.
>
> The UI ships in Japanese and English. Pull requests adding other languages are welcome —
> see [Adding a language](#言語の追加) (a new `src/locale/lang-xx.ts` plus a couple of registrations).

Devuntu への Issue・Pull Request を歓迎します。

脆弱性は公開の Issue にせず、[SECURITY.md](SECURITY.md) の手順で非公開に報告してください。

## Issue

- バグ報告・機能要望は Issue のテンプレートから作成してください
- 大きな変更や外部ライブラリの追加を伴うものは、Pull Request の前に Issue で相談してください

## 開発環境

セットアップ・ビルド・パッケージ管理の手順は [docs/dev/development.md](docs/dev/development.md) を参照してください。
画面とアクセス制御の一覧は [docs/dev/screens.md](docs/dev/screens.md) にあります。

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
- 機能や仕様を変えた場合は、対応するドキュメント(`README.md` / `README.en.md` / `docs/**/*.md`)も更新してください

## 言語の追加

画面の対応言語は日本語(`ja`)と英語(`en`)です。ほかの言語は、翻訳の Pull Request を歓迎します。
ここでは例として、ロケール `xx` を追加する手順を示します(`xx` は `fr` / `zh-TW` など、Accept-Language で使われる言語タグ)。

1. `src/locale/lang-en.ts` をコピーして `src/locale/lang-xx.ts` を作り、エクスポート名を変えて値を翻訳します
   - `${name}` の形のプレースホルダーは、そのまま残してください(表示時に値が入ります)

   ```ts
   import { DefaultLocaleItems } from '.'

   // アルファベット順
   export const xx: DefaultLocaleItems = {
     acceptance_criteria: '...',
     // ...
   }
   ```

2. `src/locale/config.ts` の `locales` と `resources` に登録します(`locales` の並びが言語切替の表示順です)

   ```ts
   import { xx } from './lang-xx'

   export const localeConfig: LocaleConfig = {
     locales: ['ja', 'en', 'xx'],
     resources: { ja, en, xx },
     // ...
   }
   ```

3. `src/lib/day.ts` の `WEEKDAY_LABELS` に、日曜始まりの曜日ラベルを追加します(未登録だとカレンダーの曜日が日本語になります)
4. `pnpm typecheck` を実行します。型 `DefaultLocaleItems` により、キーの不足や余分なキーがエラーになります
   - 翻訳できていないキーを暫定で `''` にしておくと、そのキーだけ既定ロケールの文言で表示されます
5. `pnpm dev` で起動し、サイドバー(サインイン画面などではカードの右上)の `lang` に `xx` が出ること、選ぶと表示が切り替わることを確認します
   - ログイン中に選んだ言語はアカウントに保存され、通知(メール / Slack / Webプッシュ)の文面にも使われます
   - 既定の言語にしたい場合は、環境変数 `DEFAULT_LOCALE` に `xx` を指定します

あわせて [README.md](README.md) の「表示言語」と [README.en.md](README.en.md) の対応言語の記載も更新してください。

## コーディングルール

- コンポーネントは`src/components`配下に配置し、まずは既存の部品を利用できないか検討する
- `MultiButton`のアイコンは`children`ではなく`icon`に指定する(`isPending`時のSpinner切替が効かなくなる為)
- モーダルのキャンセル+確定ボタンは`FormModal`/`DialogModal`の`submit`(または`SubmitButtons`)を使い、手で組まない
- 列挙値の Chip と選択肢は`createEnumChip`(`src/components/enum-chip.tsx`)で同じ map から作る
- ContentHeader のリロードは`ReloadButton`、取得できなかった詳細画面は`NoAccessView`を使う
- 補助テキストの色は`text-muted`、日時の表示は`dayformat(..., 'tz-minute', tz)`、値が空のときは`-`に揃える
  - 秒が意味を持つもの(ランナーの最終ポーリングなど、生存確認に使う日時)だけは`tz-simple`にする
- 外部ライブラリを追加する場合は事前に確認する
- if文は必ず{}を利用する
- Util系は`src/lib`配下に配置し、まずは既存のUtilを利用できないか検討する
- `src/lib`配下でファイル数が増えたドメインは、接頭辞が共通する、または相互に強く依存するファイル群をサブディレクトリにまとめる(例: `agent-*.ts` → `agent/`)。ファイル名は変更しない
- 汎用的で複数ドメインから参照される基盤ユーティリティ(day, logger, error, env-util等)や、単体で完結するファイルはトップレベルに残し、「utils」的な寄せ集めフォルダは作らない
- 環境変数の参照は`src/lib/env-util.ts`を利用する
- Server Actionsは基本的に利用するClientファイルと同じ階層の`server.ts`に配置する
- `src/components/general`配下は共通部品として独立させたいので、このフォルダ内で完結するようにする
  - 部品が内部で表示する文言はロケールを直接参照せず、`general/ui-text.tsx`の`GeneralUiTextProvider`経由で受け取る
- フォーム部品は、react-hook-form に依存しないものを`〇〇Field`、react-hook-form 対応のものを`〇〇Ctrl`と命名する
- 読み上げ名を受け取る props は`aria-label`で統一する
- アイコンは`createIcon`(`general/icons.tsx`)で定義する。general 配下で使うものは`general/icons.tsx`、それ以外は`src/components/icon.tsx`に置く
- テストソースは`tests`配下に配置する。`tests/lib`は`src/lib`と同じサブフォルダ構成にし、共通のモックは`tests/helpers`を使う
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
- Prismaスキーマ(`prisma/schema/*.prisma`)を更新したら、`pnpm generate`を行うこと。
- Prismaスキーマはドメインごとにファイルを分けている。新しいモデル・enumは関連するファイルに追加し、該当が無ければファイルを新設する
- コミット済みのマイグレーション(`prisma/migrations/*/`)は編集・削除しない。スキーマの変更は新しい差分マイグレーションとして追加する(ベースラインへの統合はもう行わない)

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
