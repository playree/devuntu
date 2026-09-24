- [開発](#開発)
  - [設計上の決めごと](#設計上の決めごと)
    - [チケットはボードを移動しない](#チケットはボードを移動しない)
  - [開発用インフラ起動](#開発用インフラ起動)
    - [初回に用意するファイル](#初回に用意するファイル)
  - [同一PCでの並行clone(エージェント開発用など)](#同一pcでの並行cloneエージェント開発用など)
  - [バックアップ・リストア](#バックアップリストア)
  - [インストール](#インストール)
  - [ビルド](#ビルド)
  - [テスト・Lint](#テストlint)
  - [画面の動作確認](#画面の動作確認)
  - [パッケージ更新](#パッケージ更新)
    - [`pnpm outdated`に出るが上げないもの](#pnpm-outdatedに出るが上げないもの)
    - [重複インスタンスの確認](#重複インスタンスの確認)
  - [パッケージへのパッチ](#パッケージへのパッチ)
  - [パッケージのバージョン上書き](#パッケージのバージョン上書き)
  - [TypeScript v7 と v6 の併存](#typescript-v7-と-v6-の併存)
  - [better-auth](#better-auth)
  - [イメージ作成](#イメージ作成)
    - [リリース手順](#リリース手順)
    - [ローカルでのビルド](#ローカルでのビルド)
  - [sharpの依存関係チェック](#sharpの依存関係チェック)
  - [紹介サイト(GitHub Pages)](#紹介サイトgithub-pages)

# 開発

セルフホストの導入手順は [installation.md](installation.md)、運用(バックアップ)は [operations.md](operations.md) を参照。

## 設計上の決めごと

コードを読んだだけでは分からない前提を残しておく。

### チケットはボードを移動しない

`Ticket.boardId` は**作成時にだけ決まり、以後変更しない**。今後もボード移動を許容する予定は無い。

- 作成は `scCreateTicket`(`src/lib/schema/schema.ts`)と MCP の `create_ticket` が `boardId` を受け取る
- 更新側の `scPatchTicket` と MCP の `update_ticket` には `boardId` が無く、画面にもボードを変える導線は無い
- かんばんの DnD(`moveTicket` → `moveTicketToLane`)は同一ボード内のレーン移動と並び替えだけ

この前提のうえで、本文に貼った画像の可視範囲は `Attachment.boardId` **1つ**で決めている
(配信の `/api/upload/<キー>` と MCP の `get_image` が同じ判定を通る)。チケットが動かないので、
保存済みの本文と添付のボードがずれるのは「別のボードの画像URLを貼り回したとき」だけになる。
`reassignContentAttachments`(`src/lib/board/board.ts`)がその場合に付け替えを行わないのはこのため。
動かしてしまうと、元のボードの本文からその画像が読めなくなる。

**ボード移動を入れる場合は、移動処理と同時に本文・コメントに貼られた添付の扱い(移動先ボードへの
付け替え、または複製)を決めること。** 何もしないと移動先のメンバーから画像が 404 になる。

## 開発用インフラ起動

開発に必要なのは DB(`db`サービス)とオブジェクトストレージ(`s3`サービス)のみ。まとめて起動・停止する。

```sh
# 起動
docker compose up -d db s3

# 停止
docker compose stop db s3
```

DB は `localhost:5432`、S3 API は `localhost:8333` で公開される。アップロード機能を使うには S3 API が必要。

### 初回に用意するファイル

`db` と `s3` は設定ファイルを読むため、clone 直後は起動しない。いずれも資格情報を含むので
リポジトリには入っていない(`.gitignore`)。`.env` に書いた値と揃えて2つ作る。

```sh
# .env.db — db サービスが読む。.env の DATABASE_URL と同じユーザー・パスワード・DB名にする
cat > .env.db <<'EOF'
POSTGRES_USER=devuser
POSTGRES_PASSWORD=<DATABASE_URL と同じパスワード>
POSTGRES_DB=devuntu
EOF

# seaweedfs-s3.json — s3 サービスが読む。.env の S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY と揃える
cat > seaweedfs-s3.json <<'EOF'
{
  "identities": [
    {
      "name": "devuntu",
      "credentials": [{ "accessKey": "<アクセスキー>", "secretKey": "<シークレットキー>" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
EOF
```

`.env.db` が無いと `db` が起動せず(`env file not found`)、`seaweedfs-s3.json` が無いと `s3` の起動が
エラーになる(`bind source path does not exist`)。後者は `create_host_path: false` を付けているためで、
これが無いと Docker が同名の root 所有ディレクトリを黙って作ってしまう。

**`POSTGRES_PASSWORD` は初回起動より後には変えられない。** postgres は最初の起動でボリュームを
初期化し、そのときのパスワードを保持する。変えるには `pgdata` ボリュームを作り直す。

`prisma/migrations` は `schema.prisma` から生成したフルDDL(`0_init`)をベースラインに、以降のスキーマ変更を差分マイグレーションとして積む。

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

DB/S3 のバックアップとリストア、`tools`サービスの使い方は [operations.md](operations.md) を参照。

## インストール

```sh
pnpm install
```

開発用の `.env` は手で用意する(参照する変数は [environment-variables.md](environment-variables.md))。
`pnpm setup:env` はセルフホスト用の `.env.docker` / `.env.db` / `seaweedfs-s3.json` を生成する
スクリプトで、**開発用の `.env` は対象外**。リポジトリ直下で実行すると同名のファイルを上書きするため、
動作を試すときは `--dir` で別の場所を指定する。

```sh
pnpm setup:env --dir /tmp/setup-test --dry-run
```

リモート実行機能([command-exec.md](command-exec.md))を動かす場合は、**ホストに `ssh` コマンドが必要**
(Docker イメージには `openssh-client` を同梱しているが、`pnpm dev` はホストの `ssh` を使う)。
開発時は環境変数を渡して起動すると、`.env` を汚さずに試せる。

```sh
COMMAND_EXEC_ENABLED=true \
COMMAND_DEF_DIR=$PWD/.work/command-config/commands \
COMMAND_SSH_DIR=$PWD/.work/command-config/ssh \
pnpm dev
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

`.github/workflows/ci.yml` では `pnpm lint` → `pnpm typecheck` → `pnpm test` の順で実行している
(型が壊れた状態でテストを流しても情報が増えないため)。`src/generated` はコミット済みなので
`prisma generate` は要らない。

standalone ビルドの起動確認は `pnpm test:standalone`(`scripts/test-standalone.sh`)。

## 画面の動作確認

ブラウザで実際に画面を開いて確認する手順(開発サーバーの起動、メールOTPでのログイン、スクリーンショット)は
`.claude/skills/screen-check/SKILL.md` にまとめてある。

## パッケージ更新

```sh
pnpm up -i
pnpm up -i -L
```

依存の更新は手動で行う。脆弱性のある依存は GitHub の Dependabot alerts で通知されるが、Dependabot による更新の Pull Request は作らない設定にしている(`dependabot.yml` は置かない)。通知が来たら上記の手順で該当パッケージを上げる。

pnpm v12 の `pnpm-lock.yaml` は YAML の2ドキュメント構成(1つ目が pnpm 本体、2つ目がアプリの依存)で、GitHub の Dependency graph は1つ目しか読まない。そのため `main` のロックファイルが変わるたびに、`.github/workflows/dependency-submission.yml` が `scripts/submit-dependencies.mjs` で2つ目の依存を Dependency submission API へ送っている。送る内容は `node scripts/submit-dependencies.mjs --dry-run` で件数を確認できる。

### `pnpm outdated`に出るが上げないもの

- **`prisma`** … `latest`のdist-tagが8系のRCを指している(`@prisma/client`の`latest`は7系)。`^7`の範囲では入らないので実害は無い。8系への移行はCLIとクライアントの安定版が揃ってから行う
- **`lexical` / `@lexical/react`** … 後述の[パッケージのバージョン上書き](#パッケージのバージョン上書き)を参照

### 重複インスタンスの確認

`@codemirror/*`のようにインスタンスの同一性が前提のパッケージを上げたときは、コピーが1つに収束しているかを見る。

```sh
ls -d node_modules/.pnpm/@codemirror+state@*
```

`pnpm up`直後は解決済みの依存から外れた旧バージョンのディレクトリが`node_modules/.pnpm`に残るため、ここだけを見ても判断できない。`pnpm-lock.yaml`に旧バージョンが残っていないことと、`node_modules`を消して`pnpm install`し直した状態を確認する。

## パッケージへのパッチ

`pnpm patch`で作成したパッチは`patches/`配下へ置く。登録先は`pnpm-workspace.yaml`の`patchedDependencies`で、`pnpm install`時に自動適用される。

**パッチ対象パッケージをバージョンアップした場合は、パッチの当て直しが必要。**

```sh
# 1. 編集用の一時ディレクトリを作成(パスが出力される)
pnpm patch @heroui/react

# 2. 出力されたパス配下のファイルを編集

# 3. パッチとして確定(patches/配下に保存され pnpm-workspace.yaml に登録される)
pnpm patch-commit '<出力されたパス>'
```

現在適用中のパッチは無いため、`patches/`ディレクトリと`patchedDependencies`も存在しない。

## パッケージのバージョン上書き

依存パッケージが固定しているバージョンに問題がある場合は、`pnpm-workspace.yaml`の`overrides`で差し替える。`パッケージ名>依存パッケージ名`の形式で書くと、そのパッケージの入れ子依存だけを対象にできる。

| 上書き対象 | 指定     | 理由                                       |
| ---------- | -------- | ------------------------------------------ |
| `sharp`    | `0.35.4` | Next.js の画像最適化で使うバージョンを固定 |

`lexical`と`@lexical/react`は`package.json`で`0.48.0`に固定している。`@mdxeditor/editor`が`@lexical/*`を`^0.48.0`で要求しているため、ルートだけ 0.49 系以降へ上げると MDXEditor 配下に 0.48 系が別インスタンスで残り、`useLexicalComposerContext`が別モジュールの Context を引いてメンション機能が実行時に壊れる。`overrides`で全体を揃える手もあるが、0.49.0 が組み込みノードの`$config()`移行で`importJSON`/`importDOM`/`clone`/`transform`の static を落としており、以降のバージョンも含めて MDXEditor 側が未対応。MDXEditor が追随したら上げる。

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

Docker Hub(`playree/devuntu`)への publish は GitHub Actions の `Release`
([.github/workflows/release.yml](../.github/workflows/release.yml))で行う。ローカルからは push しない。

タグの意味は下記のとおり。

| タグ        | 中身                                                     |
| ----------- | -------------------------------------------------------- |
| `edge`      | 手動実行したときの最新ビルド。確認用                     |
| `<version>` | `edge` で確認したイメージそのもの。`package.json` と同じ |
| `latest`    | 同上。`compose.yaml` が参照する                          |

### リリース手順

1. `package.json`の`version`を上げて main に入れる
2. Actions の `Release` を手動実行(`Run workflow`)する。ビルドされた`edge`が publish される
3. `docker pull playree/devuntu:edge`で動作確認する
4. 問題なければ**2で実行したのと同じ commit**に`v<version>`のタグを打って push する
5. `Release`が`edge`と同一のイメージに`<version>`と`latest`を付ける

`promote`ジョブは再ビルドせずタグを付け替えるだけなので、3で確認したものがそのまま公開される。
ビルド元の commit とタグの commit が食い違う場合と、`package.json`の`version`とタグ名が
食い違う場合はジョブが失敗する。その場合は2からやり直す。

### ローカルでのビルド

手元で動かして確かめたいときだけ使う。`docker/dummy-secrets`の中身はビルドを通すためだけの
ダミー値で、実行時の設定は`.env.docker`から渡る。

```sh
docker build -f docker/Dockerfile \
             --secret id=database_url,src=docker/dummy-secrets/database_url.env \
             --secret id=better_auth_url,src=docker/dummy-secrets/better_auth_url.env \
             --secret id=better_auth_secret,src=docker/dummy-secrets/better_auth_secret.env \
             -t devuntu .
```

## sharpの依存関係チェック

基本的に`Next.js`の要求バージョンに揃える

```sh
pnpm why sharp
```

## 紹介サイト(GitHub Pages)

`site/` は紹介用の静的サイト(`https://playree.github.io/devuntu/`)のソース。アプリとは独立しており、
ビルドツールは使わず素の HTML/CSS をそのまま配信する。

- `site/` 直下がそのまま公開ルートになる。ページを増やすときは `site/<名前>/index.html` を追加し、
  共通のスタイル・画像は `site/assets/` に置く
- Google Search Console などの所有権確認ファイル(`google<ID>.html` 等)は `site/` 直下に置く。
  Jekyll を通さないので、ファイルは加工されずに配信される
- デプロイは GitHub Actions の `Pages`([.github/workflows/pages.yml](../.github/workflows/pages.yml))。
  main への push で `site/` が変わったときと、手動実行で動く
- リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく必要がある
- アプリのビルドとイメージには含めない(`.dockerignore` と `eslint.config.ts` で除外している)
