- [開発用インフラ起動](#開発用インフラ起動)
- [同一PCでの並行clone(エージェント開発用など)](#同一pcでの並行cloneエージェント開発用など)
- [s3-toolsサービス](#s3-toolsサービス)
  - [旧イメージでの実行](#旧イメージでの実行)
- [DBバックアップ](#dbバックアップ)
- [DBリストア](#dbリストア)
- [S3バックアップ](#s3バックアップ)
  - [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)
- [S3リストア](#s3リストア)
  - [Docker環境でのS3リストア](#docker環境でのs3リストア)
  - [ボリュームを作り直す場合](#ボリュームを作り直す場合)
- [インストール](#インストール)
- [ビルド](#ビルド)
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

## s3-toolsサービス

`compose.yaml` で Docker 運用している環境向けに、S3 のバックアップ/リストアスクリプトを実行するための使い捨てコンテナを `s3-tools` サービスとして定義している。スクリプトはイメージに同梱されているので、**リポジトリの clone もホストへの node インストールも不要**で、`compose.yaml` と `.env.docker` があれば実行できる。

```sh
mkdir -p backup

# バックアップ(既定のコマンド)
docker compose run --rm s3-tools

# リストアは引数でスクリプトを指定する
docker compose run --rm s3-tools /app/scripts/restore-s3.mjs /app/backup/s3_YYYYMMDD_HHMMSS
```

- 同梱版イメージ(`0.3.1` 以降)が前提。それ以前のイメージでは[旧イメージでの実行](#旧イメージでの実行)を参照する
- `profiles: ['tools']` を付けているので `docker compose up` では起動しない
- `entrypoint` を `node` にしているので `docker-entrypoint.sh` が動かず、`prisma migrate deploy` は走らない
- 環境変数は `env_file`(`.env.docker`)から渡るので、コンテナ内の `S3_ENDPOINT` は `http://s3:8333` になる
- `depends_on` の `condition: service_healthy` により、`s3` が停止していれば起動し、healthcheck が通るまで待ってからスクリプトが実行される
- `./backup` をマウントしているので、入出力先は `compose.yaml` と同じ階層の `backup/`。引数のパスは**コンテナ内のパス**(`/app/backup/...`)で指定する
- コンテナは root で動くため、`backup/` 配下の出力は root 所有になる。事前に `mkdir -p backup` しておけばディレクトリ自体は実行ユーザー所有になり、未作成のまま実行すると Docker がマウント時に root 所有で作る

### 旧イメージでの実行

`0.3.0` 以前のイメージには `scripts/` が入っていないため、ホスト側のスクリプトを使い捨てコンテナへマウントして実行する(この場合はホストにスクリプトの実体が必要)。

```sh
docker compose run --rm \
  -v "$(pwd)/backup:/app/backup" \
  -v "$(pwd)/scripts/backup-s3.mjs:/app/backup-s3.mjs:ro" \
  --entrypoint node \
  devuntu /app/backup-s3.mjs
```

スクリプトは `/app/` 直下にマウントする。`WORKDIR` が `/app` なので出力先が `/app/backup` になり、`@aws-sdk/client-s3` も `/app/node_modules` から解決される。

## DBバックアップ

DB(`db`サービス)が起動している状態で実行する。`backup/`配下にタイムスタンプ付き(`.dump`/カスタム形式)で出力される。

```sh
pnpm db:backup
# または
./scripts/backup-db.sh
```

リポジトリを clone していない Docker 運用環境では、スクリプトと同じ内容を直接実行する。

```sh
mkdir -p backup
docker compose exec -T db pg_dump -U devuser -Fc devuntu \
  > backup/devuntu_$(date +%Y%m%d_%H%M%S).dump
```

ユーザー名と DB 名は `compose.yaml` の `POSTGRES_USER`/`POSTGRES_DB` に合わせる。

## DBリストア

対象のダンプファイルを引数に指定する。既存オブジェクトは削除された上で復元される。

```sh
pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
# または
./scripts/restore-db.sh backup/devuntu_YYYYMMDD_HHMMSS.dump
```

同じく、リポジトリを clone していない環境では直接実行する。既存 DB を作り直してから復元する(`--clean` ではダンプに含まれないテーブルと外部キーが残り、依存エラーになるため)。

アプリの停止が前提になる。`devuntu` は `restart: unless-stopped` のため、`dropdb -f` で切断してもすぐ接続を張り直して DROP が失敗する。復元後も Prisma の接続プールが古い状態を握るので、止めてから実行して最後に起動し直す。

```sh
docker compose stop devuntu

docker compose exec -T db dropdb -U devuser -f devuntu
docker compose exec -T db createdb -U devuser devuntu
docker compose exec -T db pg_restore -U devuser -d devuntu --no-owner --single-transaction \
  < backup/devuntu_YYYYMMDD_HHMMSS.dump

docker compose up -d devuntu
```

## S3バックアップ

アップロードされた画像はオブジェクトストレージ(`s3`サービス)にしか存在せず、Docker の名前付きボリューム`seaweeddata`が消えると復旧できない。DB だけ復元しても`Attachment`レコードや`link_widget.iconPath`、チケット本文の画像 URL が実体を失うため、**DB バックアップと対で取得する**。

S3 サービスが起動している状態で実行する。`.env`の`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`が必要。

```sh
pnpm s3:backup
# または
node ./scripts/backup-s3.mjs
```

S3 API 経由でオブジェクトを 1 件ずつ取得する論理バックアップで、SeaweedFS を停止せずに実行できる。`backup/`配下にタイムスタンプ付きのディレクトリが作られる。

```text
backup/s3_YYYYMMDD_HHMMSS/
├── manifest.json  … キー・Content-Type・サイズ・ETag の一覧
└── objects/       … オブジェクト本体(ファイル名=オブジェクトキー)
```

一時ディレクトリへ書き出して成功時のみ本ディレクトリへ移動するため、途中で失敗しても欠けたバックアップは残らない。オブジェクトキーは`<uuidv7>.<拡張子>`のフラット構成のため、`/`を含むキーがあった場合は警告を出してスキップする。

`weed`の内部レイアウトに依存しないので、AWS S3 や Cloudflare R2 など他の S3 互換ストレージへ`S3_ENDPOINT`を向けて復元することもできる。

### Docker環境でのS3バックアップ

[`s3-tools`サービス](#s3-toolsサービス)の既定コマンドがバックアップなので、引数なしで実行する。

```sh
mkdir -p backup
docker compose run --rm s3-tools
```

`compose.yaml`と同じ階層の`backup/`に出力される。

## S3リストア

対象のバックアップディレクトリを引数に指定する。

```sh
pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
# または
node ./scripts/restore-s3.mjs backup/s3_YYYYMMDD_HHMMSS
```

バケット(`S3_BUCKET`、既定`devuntu`)は無ければ自動作成される。Content-Type は`manifest.json`の値で復元する。

**DB リストアと挙動が異なる点**として、バックアップに含まれるキーを上書きするだけで、**ストレージ側にしか無いオブジェクトは削除しない**。同じキーへ何度実行しても安全なので、DB リストアとセットで実行してよい。

### Docker環境でのS3リストア

[`s3-tools`サービス](#s3-toolsサービス)にリストアスクリプトとコンテナ内のパスを渡す。

```sh
docker compose run --rm s3-tools \
  /app/scripts/restore-s3.mjs /app/backup/s3_YYYYMMDD_HHMMSS
```

### ボリュームを作り直す場合

`seaweeddata`ボリュームを作り直すと`/data`のディスク消費をリセットできる。過去のバージョンで作られた volume ファイル(`*.dat`)は 1 ファイルあたり 1GiB を`fallocate`で先行確保しており、実データが数 KB でもディスクを 10GB 以上占有することがある(現行の`compose.yaml`の起動オプションでは先行確保は起きない)。

必ずバックアップを取ってから実行する。

```sh
pnpm s3:backup
pnpm db:backup

docker compose stop s3 && docker compose rm -f s3
docker volume rm devuntu_seaweeddata

docker compose up -d s3
pnpm s3:restore backup/s3_YYYYMMDD_HHMMSS
```

Docker 運用環境では `pnpm` の箇所を [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)・[Docker環境でのS3リストア](#docker環境でのs3リストア)・[DBバックアップ](#dbバックアップ)の直接実行コマンドに読み替える。

消費量は`docker compose exec -T s3 sh -c 'du -sk /data'`で確認できる。

## インストール

```sh
pnpm install
```

## ビルド

```sh
pnpm build
```

`next build`(`output: 'standalone'`)の後に`scripts/patch-standalone.mjs`が走り、`@swc/helpers`の`esm/`を`.next/standalone`へ補完する。Turbopack のファイルトレースが`cjs/`しか同梱しないのに対し、Node は`module-sync`条件で`esm/`を解決するため、補完しないと`node server.js`が`MODULE_NOT_FOUND`で起動しない。`scripts/test-standalone.sh`と Docker イメージはどちらもこの成果物を使う。

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

docker tag devuntu:latest playree/devuntu:0.2.0
docker push playree/devuntu:0.2.0
```

※`0.2.0`のバージョンタグはサンプル

## sharpの依存関係チェック

基本的に`Next.js`の要求バージョンに揃える

```sh
pnpm why sharp
```
