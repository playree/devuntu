- [開発](#開発)
  - [設計上の決めごと](#設計上の決めごと)
    - [チケットはボードを移動しない](#チケットはボードを移動しない)
  - [開発用インフラ起動](#開発用インフラ起動)
    - [初回に用意するファイル](#初回に用意するファイル)
    - [ベースライン貼り替え(v0.9.1 より前の開発DBを持っている場合)](#ベースライン貼り替えv091-より前の開発dbを持っている場合)
  - [同一PCでの並行clone(エージェント開発用など)](#同一pcでの並行cloneエージェント開発用など)
  - [インストール](#インストール)
  - [環境変数の実装](#環境変数の実装)
    - [検索エンジン向けの設定](#検索エンジン向けの設定)
    - [開発専用の変数](#開発専用の変数)
  - [開発サーバー・Prisma](#開発サーバーprisma)
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

Devuntu 自体を開発する人向けの、環境構築・ビルド・パッケージ管理の手順。
ブランチ・コミット・PR の出し方とコーディングルールは [CONTRIBUTING.md](../../CONTRIBUTING.md)、
開発者向けドキュメントの一覧は [README.md](README.md) を参照。
セルフホストの導入手順は [installation.md](../admin/installation.md)、運用(バックアップ)は [operations.md](../admin/operations.md) を参照。

## 設計上の決めごと

コードを読んだだけでは分からない前提を残しておく。

### チケットはボードを移動しない

`Ticket.boardId` は**作成時にだけ決まり、以後変更しない**。今後もボード移動を許容する予定は無い。

- 作成は `scCreateTicket`(`src/lib/schema/schema-ticket.ts`)と MCP の `create_ticket` が `boardId` を受け取る
- 更新側の `scPatchTicket` と MCP の `update_ticket` には `boardId` が無く、画面にもボードを変える導線は無い
- かんばんの DnD(`moveTicket` → `moveTicketToLane`)は同一ボード内のレーン移動と並び替えだけ

この前提のうえで、本文に貼った画像の可視範囲は `Attachment.boardId` **1つ**で決めている
(配信の `/api/upload/<キー>` と MCP の `get_image` が同じ判定を通る)。チケットが動かないので、
保存済みの本文と添付のボードがずれるのは「別のボードの画像URLを貼り回したとき」だけになる。
`reassignContentAttachments`(`src/lib/board/ticket-write.ts`)がその場合に付け替えを行わないのはこのため。
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

Prismaスキーマは `prisma/schema/` 配下にドメインごとのファイル(`board.prisma` / `ticket.prisma` など)で分けて置き、generator / datasource は `schema.prisma` に持つ。

`prisma/migrations` は Prismaスキーマから生成したフルDDL(`0_init`)をベースラインに、以降のスキーマ変更を差分マイグレーションとして積む。
ベースラインへの統合は一般公開前(v0.9.1)に行ったものが最後で、今後は行わない。
コミット済みのマイグレーションは編集・削除せず、スキーマの変更は `pnpm migrate` で新しい差分マイグレーションを作って追加する。

### ベースライン貼り替え(v0.9.1 より前の開発DBを持っている場合)

**v0.9.1 の統合を取り込む前から使っている開発DBは、そのままでは `prisma migrate` が動かない。**
`_prisma_migrations` に残る旧 `0_init` の checksum が新しい `migration.sql` と一致せず、
`migrate deploy` / `migrate dev` が「適用済みのマイグレーションが変更されている」として失敗する。

統合前の最新(`20260930120000_tidy_schema`)まで適用済みであることを確認してから、履歴を1行の `0_init` に貼り替える。
DDL は流れないのでデータはそのまま残る。

```sh
echo 'DELETE FROM "_prisma_migrations";' | pnpm exec prisma db execute --stdin
pnpm exec prisma migrate resolve --applied 0_init
pnpm exec prisma migrate status   # Database schema is up to date!
```

データが要らないなら `pnpm exec prisma migrate reset` で作り直してもよい。
新しく作るDBは `pnpm migrate` を1回流すだけでよく、この作業は不要。

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

## インストール

```sh
pnpm install
```

開発用の `.env` は手で用意する(参照する変数は [environment-variables.md](../admin/environment-variables.md))。
`pnpm setup:env` はセルフホスト用の `.env.docker` / `.env.db` / `seaweedfs-s3.json` を生成する
スクリプトで、**開発用の `.env` は対象外**。リポジトリ直下で実行すると同名のファイルを上書きするため、
動作を試すときは `--dir` で別の場所を指定する。

```sh
pnpm setup:env --dir /tmp/setup-test --dry-run
```

リモート実行機能([command-exec.md](../admin/command-exec.md))を動かす場合は、**ホストに `ssh` コマンドが必要**
(Docker イメージには `openssh-client` を同梱しているが、`pnpm dev` はホストの `ssh` を使う)。
開発時は環境変数を渡して起動すると、`.env` を汚さずに試せる。

```sh
COMMAND_EXEC_ENABLED=true \
COMMAND_DEF_DIR=$PWD/.work/command-config/commands \
COMMAND_SSH_DIR=$PWD/.work/command-config/ssh \
pnpm dev
```

## 環境変数の実装

運用者向けの変数の一覧と運用上の注意は [environment-variables.md](../admin/environment-variables.md) にある。
ここには実装側の決めごとと、開発専用の変数を置く。

- 定義元は `src/lib/env-util.ts`。参照時も同ファイルの `envu` を利用する
- 真偽値の変数は `true` / `false`(大文字小文字は問わない)だけを受け付ける。`1` や綴り違いが
  黙って既定の反対側へ倒れると気づけないため、読み取り時にエラーにしている。数値の変数も同様に、
  整数でない値(`abc` / `1.5` など)や範囲外の値は読み取り時にエラーにしている
- 範囲の根拠。`RELEASE_NOTES_LIMIT` の上限100は GitHub API の `per_page` の上限、`AGENT_RUN_KEEP` の
  下限100は画面が出せる件数に合わせている(下回ると「一覧に出ているのに実体が無い」履歴が生まれる)
- 起動時に渡す値は `NEXT_PUBLIC_*` にしない。配布物は事前ビルド済みのイメージで、`NEXT_PUBLIC_*` は
  ビルド時にインライン化されるため起動時に渡した値が入らない。VAPID 公開鍵も Server Action で実行時に返している
- `SESSION_FRESH_AGE` のチェックは `src/lib/auth/session-fresh.ts`
- `NOTIFY_WORKER_ENABLED=false` で止まるのは配信側だけで、通知は `notify_outbox` へ溜まる
  ([notifications-internals.md](notifications-internals.md#通知キューと配信ワーカー))
- `MAINTENANCE_ATTACHMENT_GRACE_HOURS` は、添付が本文の保存より先に作られることへの猶予。作成フォームを
  開いたまま放置している間、その画像はまだどこからも参照されていないため、この時間が経つまでは削除対象にしない
- `MAINTENANCE_MODE_FILE` の既定は**実行時の cwd 相対**で、切り替える側(`scripts/maintenance.mjs`)の既定も
  cwd 相対なので同じファイルを指す。Docker では `WORKDIR /app` なので `/app/config/maintenance` になり、
  `compose.yaml` がホストの `./config` をマウントしているため `tools` 側と同じ実体になる。clone した環境
  (`pnpm dev`)ではリポジトリ直下の `config/maintenance` になる
- リモート実行の実行ログは SSE(`/api/command/runs/[id]/stream`)で配信する。アプリ側でも
  `X-Accel-Buffering: no` と `Cache-Control: no-transform` を付けているが、設定によってはリバースプロキシ側が優先される

### 検索エンジン向けの設定

- `SEARCH_ENGINE_INDEXING` の拒否時は、`<meta name="robots">`(`src/app/layout.tsx`)と `X-Robots-Tag` ヘッダ
  (`src/proxy.ts`)が `noindex, nofollow` になる。空き時間の共有(`/cal/[id]`)は設定に関わらず常に `noindex`
- `/robots.txt` は `src/app/robots.ts`。`SEARCH_ENGINE_INDEXING=true` は載せる意思表示なので、
  `SEARCH_ENGINE_ROBOTS_ALLOW` によらずクロール許可になる
- `X-Robots-Tag` が付くのは Proxy が通常処理を継続したページ応答だけ。認証を素通しするパス
  (`isProxyAuthBypassPath()` の `/api/**`・`/.well-known/**`・拡張子を含むパス)と Server Action(`next-action` ヘッダ)、
  認証リダイレクトと管理者拒否の rewrite は、ヘッダを付ける前に返る。これらを追わないのは、`/api/` と `/cal/` は
  クロール許可時も `/robots.txt` で `Disallow` しており、拡張子を含むパスは検索結果に載る HTML ではないため。
  素通しのパス(静的アセットを含む)でセッション取得を走らせない点も兼ねている。Proxy の matcher の事情は
  [screens.md](screens.md#アクセス制御の仕組み) を参照

### 開発専用の変数

| 変数名                | 説明                                                                      | デフォルト |
| --------------------- | ------------------------------------------------------------------------- | ---------- |
| `DEV_ALLOWED_ORIGINS` | `next dev` で許可する追加オリジン(カンマ区切り)。開発時のみ有効           | -          |
| `DEBUG_LINODE_DUMMY`  | Linode ダミー応答(JSON)。設定するとダッシュボードの Linode 転送情報に出す | -          |

`DEV_ALLOWED_ORIGINS` だけは例外で、`src/lib/env-util.ts` には定義していない。参照元の `next.config.ts` は
Next の起動前に評価されるため `envu` を解決できず、`process.env` を直接読んでいる。
`DEBUG_LINODE_DUMMY` は JSON として解釈できない値だと読み取り時にエラーになる。

以下は利用者が直接設定しない内部変数。

- `BUILD_NO` : ビルド番号。`next.config.ts` の `env` で自動生成・注入される
- `NODE_ENV` : 実行環境(`development`/`production` 等)。実行環境側で設定される

## 開発サーバー・Prisma

```sh
pnpm dev         # next dev(http://localhost:3000)
pnpm dev:domain  # .env.domain を優先して読み込んで next dev(足りない変数は .env から)
pnpm migrate     # prisma migrate dev(スキーマの変更からマイグレーションを作成・適用)
pnpm generate    # prisma generate(src/generated/prisma を再生成)
pnpm studio      # prisma studio(DB の中身をブラウザで見る)
```

Prismaスキーマ(`prisma/schema/*.prisma`)を変えたら `pnpm generate` を実行する。
`src/generated` はコミット対象なので、生成結果も一緒にコミットする。

## ビルド

```sh
pnpm build
```

`next build`(`output: 'standalone'`)の後に`scripts/patch-standalone.mjs`が走り、`@swc/helpers`の`esm/`を`.next/standalone`へ補完する。Turbopack のファイルトレースが`cjs/`しか同梱しないのに対し、Node は`module-sync`条件で`esm/`を解決するため、補完しないと`node server.js`が`MODULE_NOT_FOUND`で起動しない。また、`src/lib/command/command-catalog.ts`の環境変数由来のパスを使う fs 呼び出しをトレースが解決できず`src/lib/command`の .ts を同梱してしまうため、実行時に不要な`.next/standalone/src`を削除する(instrumentation のトレースには`outputFileTracingExcludes`が効かない)。`scripts/test-standalone.sh`と Docker イメージはどちらもこの成果物を使う。

standalone ビルドでは `web-push` がサーバーチャンクへバンドルされ、`node_modules` に実体が残らない。そのため
イメージ内では `require('web-push')` が `MODULE_NOT_FOUND` になり、`generateVAPIDKeys()` を使えない
(導入手順では `node:crypto` のワンライナーで VAPID 鍵を生成している。[installation.md](../admin/installation.md#webプッシュ通知))。

## テスト・Lint

テストソースは `tests/` 配下、設定は `vitest.config.ts` と `vitest.setup.ts`。

| 場所                | 内容                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| `tests/lib/`        | `src/lib/` のテスト。サブフォルダ構成とファイル名は `src/lib/` に揃える          |
| `tests/app/`        | Route Handler など `src/app/` のテスト                                           |
| `tests/components/` | `src/components/` のテスト。サブフォルダ構成は `src/components/` に揃える        |
| `tests/scripts/`    | `scripts/` の運用ツールのテスト                                                  |
| `tests/helpers/`    | 共通ヘルパー(Prisma のモック、MCP クライアントの接続、`ResourceAuth` の偽データ) |

`@/lib/prisma` の差し替えは `tests/helpers/prisma.ts` の `mockPrisma` を使う。`vi.mock` の factory は
import より先に評価されるため、factory の中で動的 import する。

```ts
vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ user: ['findUnique'] }))
```

```sh
pnpm test        # vitest run
pnpm test:watch  # vitest(ウォッチ)
pnpm lint        # eslint
pnpm typecheck   # next typegen && tsc --noEmit(TS7/tsgo)
pnpm prettier    # 整形
```

`.github/workflows/ci.yml` では `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` の順で実行している
(型が壊れた状態でテストを流しても情報が増えないため)。`src/generated` はコミット済みなので
`prisma generate` は要らない。Build はイメージと同じダミー値(`docker/dummy-secrets/`)を環境変数に入れて
standalone 出力まで通し、リリース時のビルド失敗を PR の時点で拾う。

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
([.github/workflows/release.yml](../../.github/workflows/release.yml))と `Promote stable`
([.github/workflows/promote-stable.yml](../../.github/workflows/promote-stable.yml))で行う。ローカルからは push しない。

イメージは linux/amd64 と linux/arm64 のマルチアーキ。QEMU だと arm64 の Next.js ビルドが遅いため、
プラットフォームごとにネイティブランナー(`ubuntu-latest` / `ubuntu-24.04-arm`)で並列にビルドし、digest をまとめて `edge` にする。

タグの意味は下記のとおり。後ろのタグほど、前のタグで確認したイメージを再ビルドせずに付け替えたもの。

| タグ        | 中身                                                              |
| ----------- | ----------------------------------------------------------------- |
| `edge`      | 手動実行したときの最新ビルド。確認用                              |
| `<version>` | `edge` で確認したイメージそのもの。`package.json` と同じ          |
| `latest`    | 最新のリリース(`<version>` と同じ)                                |
| `stable`    | リリース後に問題が無かった `<version>`。`compose.yaml` が参照する |

`stable` を付けるときは、git タグ `stable` も同じ commit へ動かす。導入手順の `compose.yaml` はこの git タグから取得するため、
利用者の `compose.yaml` は常に `stable` のイメージと同じ版になる。

### リリース手順

1. `package.json`の`version`を上げて main に入れる
2. Actions の `Release` を手動実行(`Run workflow`)する。ビルドされた`edge`が publish される
3. `docker pull playree/devuntu:edge`で動作確認する
4. 問題なければ**2で実行したのと同じ commit**に`v<version>`のタグを打って push する
5. `Release`が`edge`と同一のイメージに`<version>`と`latest`を付ける
6. `latest`で一定期間問題が無ければ、Actions の `Promote stable` を`version`を指定して手動実行する

`promote`ジョブは再ビルドせずタグを付け替えるだけなので、3で確認したものがそのまま公開される。
ビルド元の commit とタグの commit が食い違う場合と、`package.json`の`version`とタグ名が
食い違う場合はジョブが失敗する。その場合は2からやり直す。

`Promote stable` も同様に、`<version>` のイメージのビルド元が `v<version>` のタグの commit と一致しない場合
(タグが無い場合を含む)は失敗する。過去の `version` を指定すれば `stable` を戻せるが、`stable` を使っている環境で
既に新しい版のマイグレーションが適用されていると古い版では動かない可能性があるため、戻すより修正版のリリースを優先する。

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
- 画面のスクリーンショット(`site/assets/screenshots/`)は `docs/images/` の同名ファイルの複製。
  `docs/images/` を撮り直したら、こちらにもコピーする(Pages には `site/` しか配信されないため)
- 機能一覧は README の「できること」に合わせる。機能を追加・変更したら日英両方のページも更新する
- 「ドキュメント」節のリンクは GitHub 上の `docs/guide/README.md` / `docs/admin/README.md` / `docs/dev/README.md` などを指す。
  docs の構成を変えたら、日英両方のリンクも直す
- 英語ページは `site/en/index.html`。内容を変えたら日英両方を更新し、`hreflang` の相互リンクも揃える
- ページを増やしたら `site/sitemap.xml` にも追加する。robots.txt はドメイン直下(`playree.github.io/robots.txt`)
  しか読まれずプロジェクトサイトでは効かないため、サイトマップは Search Console から送信する
- Google Search Console などの所有権確認ファイル(`google<ID>.html` 等)は `site/` 直下に置く。
  Jekyll を通さないので、ファイルは加工されずに配信される
- デプロイは GitHub Actions の `Pages`([.github/workflows/pages.yml](../../.github/workflows/pages.yml))。
  main への push で `site/` が変わったときと、手動実行で動く
- リポジトリの Settings → Pages → Source を「GitHub Actions」にしておく必要がある
- アプリのビルドとイメージには含めない(`.dockerignore` と `eslint.config.ts` で除外している)
