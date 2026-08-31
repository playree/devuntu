- [開発用インフラ起動](#開発用インフラ起動)
- [同一PCでの並行clone(エージェント開発用など)](#同一pcでの並行cloneエージェント開発用など)
- [バックアップ・リストア](#バックアップリストア)
- [インストール](#インストール)
- [ビルド](#ビルド)
- [テスト・Lint](#テストlint)
- [画面の動作確認](#画面の動作確認)
- [パッケージ更新](#パッケージ更新)
- [パッケージへのパッチ](#パッケージへのパッチ)
- [パッケージのバージョン上書き](#パッケージのバージョン上書き)
- [TypeScript v7 と v6 の併存](#typescript-v7-と-v6-の併存)
- [better-auth](#better-auth)
- [イメージ作成](#イメージ作成)
  - [Docker Build](#docker-build)
  - [Docker Hub Push](#docker-hub-push)
- [sharpの依存関係チェック](#sharpの依存関係チェック)

# 開発

セルフホストの導入手順は [installation.md](installation.md)、運用(バックアップ)は [operations.md](operations.md) を参照。

## 開発用インフラ起動

開発に必要なのは DB(`db`サービス)とオブジェクトストレージ(`s3`サービス)のみ。まとめて起動・停止する。

```sh
# 起動
docker compose up -d db s3

# 停止
docker compose stop db s3
```

DB は `localhost:5432`、S3 API は `localhost:8333` で公開される。アップロード機能を使うには S3 API が必要。

## 同一PCでの並行clone(エージェント開発用など)

DB・S3のコンテナは増やさず共有したまま、`git clone` したもう一つのディレクトリで別ポートの `next dev` を並行稼働できる。

```sh
# DB(1回だけ)
docker exec devuntu-postgres createdb -U devuser devuntu-agent

# バケットは初回アップロード時に自動作成されるため事前作業は不要
```

2つ目の clone の `.env` は1つ目の内容をコピーしたうえで、以下だけ差し替える。

| 変数名            | 値                                                                            |
| ----------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`    | `postgresql://devuser:devPassW0rd@localhost:5432/devuntu-agent?schema=public` |
| `BETTER_AUTH_URL` | `http://localhost:3010`                                                       |
| `S3_BUCKET`       | `devuntu-agent`                                                               |

`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` はコンテナ共有のため変更不要。起動は次のとおり。

```sh
# 初回はマイグレーションも忘れずに
pnpm migrate

PORT=3010 pnpm dev
```

Google/Slack など外部OAuthのコールバックURLは `http://localhost:3000/...` 決め打ちで登録されていることが多い。この並行clone(`localhost:3010`)でOAuthログインを試す場合は、各サービスの管理画面側でコールバックURLを別途追加登録する必要がある。

## バックアップ・リストア

DB/S3 のバックアップとリストア、`s3-tools`サービスの使い方は [operations.md](operations.md) を参照。

## インストール

```sh
pnpm install
```

## ビルド

```sh
pnpm build
```

`next build`(`output: 'standalone'`)の後に`scripts/patch-standalone.mjs`が走り、`@swc/helpers`の`esm/`を`.next/standalone`へ補完する。Turbopack のファイルトレースが`cjs/`しか同梱しないのに対し、Node は`module-sync`条件で`esm/`を解決するため、補完しないと`node server.js`が`MODULE_NOT_FOUND`で起動しない。`scripts/test-standalone.sh`と Docker イメージはどちらもこの成果物を使う。

## テスト・Lint

テストソースは `tests/` 配下、設定は `vitest.config.ts` と `vitest.setup.ts`。

```sh
pnpm test        # vitest run
pnpm test:watch  # vitest(ウォッチ)
pnpm lint        # eslint
pnpm typecheck   # next typegen && tsc --noEmit(TS7/tsgo)
pnpm prettier    # 整形
```

`.github/workflows/ci.yml` では `pnpm lint` と `pnpm test` を実行している。

standalone ビルドの起動確認は `pnpm test:standalone`(`scripts/test-standalone.sh`)。

## 画面の動作確認

ブラウザで実際に画面を開いて確認する手順(開発サーバーの起動、メールOTPでのログイン、スクリーンショット)は
`.claude/skills/screen-check/SKILL.md` にまとめてある。

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

| 上書き対象 | 指定     | 理由                                       |
| ---------- | -------- | ------------------------------------------ |
| `sharp`    | `0.35.3` | Next.js の画像最適化で使うバージョンを固定 |

`lexical`と`@lexical/react`は`package.json`で`0.48.0`に固定している。`@mdxeditor/editor`が`@lexical/*`を`^0.48.0`で要求しているため、ルートだけ 0.49 系へ上げると MDXEditor 配下に 0.48 系が別インスタンスで残り、`useLexicalComposerContext`が別モジュールの Context を引いてメンション機能が実行時に壊れる。`overrides`で全体を 0.49 系へ揃える手もあるが、0.49.0 は組み込みノードの`$config()`移行で`importJSON`/`importDOM`/`clone`/`transform`の static を落としており MDXEditor 側が未対応。MDXEditor が追随したら上げる。

HeroUI 3.2.3 の頃は`@heroui/{react,styles}>tailwind-variants`を`^3.3.1`へ上書きしていた。3.3.0 の slots リゾルバが単一の slots オブジェクトを使い回し、同じ tv を別の props で呼ぶと先に取得済みの slot 関数の戻り値まで後の props に化けるバグがあり、`Modal.Backdrop`の`variant='blur'`が`opaque`に化けていたため。HeroUI 3.2.4 が`tailwind-variants@3.3.1`を固定依存にしたので上書きは削除した。

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

docker tag devuntu:latest playree/devuntu:<version>
docker push playree/devuntu:<version>
```

※`<version>`は`package.json`の`version`に合わせる

## sharpの依存関係チェック

基本的に`Next.js`の要求バージョンに揃える

```sh
pnpm why sharp
```
