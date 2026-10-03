- [運用の仕組み(開発者向け)](#運用の仕組み開発者向け)
  - [スクリプトの構成](#スクリプトの構成)
  - [toolsサービスの実装](#toolsサービスの実装)
  - [バックアップ・リストアの実装](#バックアップリストアの実装)
    - [DB](#db)
    - [S3](#s3)
    - [一括バックアップ / リストア](#一括バックアップ--リストア)
  - [メンテナンスモードの実装](#メンテナンスモードの実装)
    - [フラグの実体](#フラグの実体)
    - [遮断の仕組み](#遮断の仕組み)
    - [ワーカーの止め方](#ワーカーの止め方)
  - [自動メンテナンスの実装](#自動メンテナンスの実装)
    - [削除条件](#削除条件)
    - [添付の掃除](#添付の掃除)
    - [アバターの配信](#アバターの配信)
    - [ボード削除](#ボード削除)
    - [インデックスを足す目安](#インデックスを足す目安)

# 運用の仕組み(開発者向け)

バックアップ・リストア・メンテナンスモード・自動メンテナンスの実装と、その設計判断をまとめる。
手順・コマンド・確認方法(運用者向け)は [operations.md](../admin/operations.md) を参照。

## スクリプトの構成

`package.json` のスクリプトと実体の対応。`tools` サービスも同じスクリプトをイメージ同梱のまま実行する。

| コマンド            | 実体                      |
| ------------------- | ------------------------- |
| `pnpm db:backup`    | `scripts/backup-db.mjs`   |
| `pnpm db:restore`   | `scripts/restore-db.mjs`  |
| `pnpm s3:backup`    | `scripts/backup-s3.mjs`   |
| `pnpm s3:restore`   | `scripts/restore-s3.mjs`  |
| `pnpm full:backup`  | `scripts/backup-all.mjs`  |
| `pnpm full:restore` | `scripts/restore-all.mjs` |
| `pnpm maintenance`  | `scripts/maintenance.mjs` |

リポジトリを clone した環境(開発環境など)では、`docker compose run --rm tools <サブコマンド>` の代わりに
これらを使う。引数は `tools` と同じ(例: `pnpm full:restore backup/full_YYYYMMDD_HHMMSS`、`pnpm maintenance on`)。
`node ./scripts/backup-db.mjs` のように直接実行してもよい。

- 接続先は `.env` の `DATABASE_URL` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` から解決する
- ホストに `pg_dump` が無い場合は `docker compose exec -T db` 経由へ自動で切り替わる(どちらで実行したかは1行目に出力される)。
  外部の PostgreSQL を使う構成では、実行するホストに `postgresql-client` を入れる(入っていない場合は実行前にエラーで止まる)
- S3 バックアップの中身は次のとおり

```text
backup/s3_YYYYMMDD_HHMMSS/
├── manifest.json  … キー・Content-Type・サイズ・ETag の一覧
└── objects/       … オブジェクト本体(ファイル名=オブジェクトキー)
```

## toolsサービスの実装

`compose.yaml` の `tools` サービスは、イメージ同梱のスクリプトを実行する使い捨てコンテナ。

- `profiles: ['tools']` を付けているので `docker compose up` では起動しない
- `entrypoint` を `node /app/scripts/tools.mjs` にしているので `docker-entrypoint.sh` が動かず、`prisma migrate deploy` は走らない
- 環境変数は `env_file`(`.env.docker`)から渡るので、コンテナ内の `S3_ENDPOINT` は `http://s3:8333`、`DATABASE_URL` の接続先は `db:5432` になる。`setup-env` は `.env.docker` を作る側なので、`required: false` を付けて「あれば読む」にしてある(Docker Compose v2.24 以降が必要)
- `compose.yaml` のあるディレクトリを `/work` へマウントして作業ディレクトリにしているため、設定ファイルの生成先も `backup/` の入出力先も `compose.yaml` と同じ階層になる。引数のパスはホストで見えるパス(`backup/...`)をそのまま書ける
- コンテナは root で動くが、`backup/` 配下の出力と `setup-env` が生成する設定ファイルは、実行ユーザーが扱えるよう `compose.yaml` のあるディレクトリの所有者に合わせている
- `db` / `s3` への `depends_on` は持たない(`setup-env` は `db` / `s3` が必要とする設定ファイルを作る側のため)
- `db-backup` / `db-restore` が使う `pg_dump` / `pg_restore` / `psql` はイメージに同梱している。バージョンは `compose.yaml` の `postgres:18` と揃えているので、`db` サービスのメジャーバージョンを上げるときは `docker/Dockerfile` の `postgresql-client-18` も合わせる
- 表示言語は `DEFAULT_LOCALE` に従う(`ja` なら日本語、それ以外は英語)。`.env.docker` の値が渡るので、アプリと同じ言語になる

## バックアップ・リストアの実装

### DB

- `backup-db.mjs` は一時ファイルへ出力し、成功時だけ本ファイルへ移す。直接書くと `pg_dump` 失敗時に空や壊れた `.dump` が残り、後のリストアで事故になるため
- ホストに `pg_dump` が無い場合は `docker compose exec -T db` 経由へ切り替える。この経路はコンテナ内のローカル接続になり接続先ホストを指定できないため、`DATABASE_URL` が外部の PostgreSQL を指している場合は、同梱の `db` を誤って操作しないよう実行前にエラーで止める
- `restore-db.mjs` は既存 DB を作り直してから復元する。`--clean` ではダンプに含まれないテーブルと外部キーが残り、依存エラーになるため
- 対象 DB に他の接続が残っている場合は中断する(`--force` で無視)。`devuntu` は `restart: unless-stopped` のため、動かしたまま実行すると `DROP DATABASE` の直後に接続を張り直し、復元後も Prisma の接続プールが古い状態を握るため
- `--wait <秒>` は対象 DB への他の接続数が 0 になるのを待ってから復元を始める。上限まで残っていれば復元せずに中断する

### S3

- S3 API 経由でオブジェクトを 1 件ずつ取得する論理バックアップ。`weed` の内部レイアウトに依存しないので、他の S3 互換ストレージへ `S3_ENDPOINT` を向けて復元できる
- 一時ディレクトリへ書き出し、成功時のみ本ディレクトリへ移動する
- オブジェクトキーは `<uuidv7>.<拡張子>` のフラット構成。`/` を含むキーがあった場合は警告を出してスキップする
- `manifest.json` にはキー・Content-Type・サイズ・ETag を記録する。リストア時の Content-Type はこの値を使う
- リストアはバックアップに含まれるキーを上書きするだけで、ストレージ側にしか無いオブジェクトは削除しない(同じキーへ何度実行しても安全)
- 古い起動オプションの SeaweedFS で作られた volume ファイル(`*.dat`)は、1 ファイルあたり 1GiB を `fallocate` で先行確保している。実データが数 KB でもディスクを 10GB 以上占有することがあるため、運用者向けにはボリュームの作り直し手順を案内している(現行の `compose.yaml` の起動オプションでは先行確保は起きない)

### 一括バックアップ / リストア

- `backup-all.mjs` は `backup-db.mjs` / `backup-s3.mjs` を `--out` 付きで順に呼ぶ。`pnpm db:backup` / `pnpm s3:backup` を引数なしで実行したときの挙動は変えていない
- 一時ディレクトリ `full_*.tmp/` へ書き、両方成功したときだけ `full_*/` へ移す。片方が失敗したら即中断し、一時ディレクトリごと捨てる
- 取得順は DB → S3。この順なら、取得の間に追加されたものは S3 側にしか無い未参照オブジェクトとして残るだけで害がない(取得の間に削除されたものは、DB 側に参照が残ったまま S3 側から実体が消える)
- `--maintenance` は ON にした後、対象 DB への他の接続が 0 になるまで最大60秒待つ。アプリは実行中のワーカーが終わってから接続を手放すため、0 になれば書き込みは止まっている。終了時は成否に関わらず OFF に戻す(Ctrl+C / SIGTERM でも)。開始前から ON だった場合は運用者が入れた遮断なので、ON にも OFF にもしない
- `restore-all.mjs` は `restore-db.mjs` が `DROP DATABASE` から始めるため、破壊的操作の前に中身を検証する。`restore-s3.mjs --check`(ストレージへは接続しない)で、manifest が JSON として読めること、参照されている `objects/<キー>` がすべて実在すること、Content-Type が決まることまで確かめる
- `restore-all.mjs` は `restore-db.mjs` を `--wait 60` 付きで呼ぶ。`--force` はそのまま `restore-db.mjs` へ渡る

## メンテナンスモードの実装

### フラグの実体

**ファイルの有無**で持つ。DB に載せないのは、DB を作り直している最中でも遮断が効いている必要があるため。

| 見る側                 | パス                                                         |
| ---------------------- | ------------------------------------------------------------ |
| アプリ                 | `<cwd>/config/maintenance`(環境変数 `MAINTENANCE_MODE_FILE`) |
| 操作側(tools / ホスト) | `config/maintenance`(cwd 相対。`--file` で変更できる)        |

どちらも cwd 相対なので、Docker 運用でも clone した環境でも同じファイルを指す。
Docker では `WORKDIR /app` なのでアプリ側は `/app/config/maintenance` になり、`compose.yaml` が
ホストの `./config` を `devuntu` へ `/app/config`、`tools` へ `/work/config` としてマウントして
いるため、両者は同じ実体になる。

clone した環境(`pnpm dev` / `pnpm maintenance`)では、どちらもリポジトリ直下の `config/maintenance`
になる。アプリ側だけ絶対パス固定にすると、この場合に両者が食い違って遮断できない。

切り替えは各プロセスが自分でファイルの有無に追随する形で反映される(遅れは最大1秒)。

### 遮断の仕組み

| 対象                                  | メンテナンス中                               |
| ------------------------------------- | -------------------------------------------- |
| 画面                                  | `/maintenance` の案内を 503 で表示           |
| Server Action(画面操作)               | 503 JSON                                     |
| API(`/api/**`。MCP `/api/mcp` を含む) | 503 JSON                                     |
| `/api/health`                         | **通常どおり 200**(監視と compose の疎通)    |
| `_next/*` と `/favicon.ico`           | **通常どおり配信**(案内画面を出すために必要) |

いずれも `Retry-After` を付けて返す。

- 遮断は `src/proxy.ts` の1箇所に集約してあり、各 API ルートや Server Action には手を入れていない
- `/sw.js` や `/robots.txt` のような拡張子付きのパスも遮断する。Proxy の matcher から外すと、`/api/upload/<キー>.webp` のような**拡張子を持つルートハンドラ**まで素通しになり、遮断中に DB を引いて接続を張り直してしまうため
- 判定にセッションを使わないので、DB が止まっていても確実に効く。その代わり管理者も含めて全員が遮断され、画面からは解除できない

### ワーカーの止め方

バックグラウンドの3つのワーカー(通知 / 掃除 / リモート実行)も止める。動いたままだと DB の接続が
復活し、リストアの接続チェックに引っかかるため。

ただし**実行中の処理は打ち切らない**。新しい周を始めないだけで、実行中のものは最後にログ・
生存申告・終了状態を書くので、それが終わってから接続を手放す。これにより「接続数 0」が
「ワーカーも完了済み」を意味し、リストア側の待ち(`--wait`)がそのまま関門になる。

## 自動メンテナンスの実装

ソースは `src/lib/maintenance/`。起動の1分後に1周し、以降は1時間ごと(添付の掃除だけは1日1回)。
1つの手順が失敗しても他の手順は動き、失敗した手順は `maintenance sweep finished` の件数が -1 になる。

### 削除条件

| 対象                     | 消す条件                                                                                 | 保持       |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------- |
| `session`                | `expiresAt` 超過                                                                         | 24時間     |
| `verification`           | `expiresAt` 超過(使われなかったOTPなど)                                                  | 24時間     |
| `oauth_refresh_token`    | 期限切れ/失効済み、かつ再提示の検出期間も過ぎ、生きたアクセストークンが無い              | 24時間     |
| `oauth_access_token`     | `expiresAt` または `revoked` が過去                                                      | 24時間     |
| `oauth_client_assertion` | `expiresAt` 超過                                                                         | なし       |
| `upload_nonce`           | `expiresAt` 超過(アップロード時の掃除の取りこぼし)                                       | なし       |
| `agent_run`              | 開始が保持期間より古い + ランナーごとに新しい N 件だけ残す                               | 既定90日   |
| `command_run`            | 受付が保持期間より古い + コマンドごとに新しい N 件だけ残す                               | 既定90日   |
| `ticket_activity`        | 記録が保持期間より古い(チケットの変更履歴)                                               | 既定365日  |
| `git_check_suite`        | 更新が保持期間より古い(GitHub / GitLab 連携の CI 結果。マージ済み・放置された PR のもの) | 90日       |
| `attachment` + 実体      | どの本文からも参照されていない                                                           | 既定24時間 |

- 消す条件はすべて、書き手が「もう使わない」と記録した列に紐づけてある
- `session` を消しても MCP のトークンは失効しない(参照は `SetNull` で、Webの5日とMCPの180日は独立)
- `git_check_suite` は、ボードからリポジトリの対応付けを外したときにも、その対応付けで受け取った行がまとめて消える
- `command_run` を消すとログ(`command_run_chunk`)も一緒に消える。実行 1 件のログは数千行になりうるため、残す件数の既定はエージェントの実行履歴より絞ってある
- `command_run` の `queued` / `running` は実行側が持ち主なので掃除は触らない(掃除が先に消すと、実行中のワーカーが書き込み先を失う)
- エージェントの月ごとの利用量(`agent_usage`)は掃除の対象にしない。実行履歴が消えても月のコストと予算上限の判定が狂わないよう、実行履歴とは別に積み上げているため(1 エージェント × ボード × 月で 1 行なので増え方は小さい)

### 添付の掃除

添付は `attachment` テーブルと実体の両方を消す。参照は外部キーではなく本文中のURLなので、
次の6箇所を見て「どこからも参照されていない」ことを確かめてから消す。

- チケット本文の Markdown
- コメント本文の Markdown
- チケットテンプレート本文の Markdown(`ticket_template.content`)
- ユーザーのアバター(`user.image`)
- リンクウィジェットのアイコン(`link_widget.iconPath`)
- お知らせ本文(`key_value_store` の `DASHBOARD_ANNOUNCEMENT`)

ボードの AI 向けコンテキスト(`board.aiContext`)とエージェントのカスタム指示(`agent_runner.rule`)は
AI に渡す文字列なので参照元に含めない。エディタからは画像を挿入できないようにしている。

本文の全走査を伴うので、この掃除だけは1日1回に絞っている。

削除は**実体 → レコードの順**。逆順にするとレコードだけ消えた場合にキーを辿れなくなり、
掃除の対象から永久に外れてしまう。この順なら実体だけ消えても次回に拾い直して収束する。

`MAINTENANCE_ATTACHMENT_GRACE_HOURS` の猶予は、添付が本文の保存より先に作られるため。
作成フォームを開いたまま放置している間、その画像はまだどこからも参照されていない。

OIDC/ソーシャルログインは、IdP のアバターを取り込むために**サインインの途中で添付を作る**。
取り込んだ後にサインインが失敗すると(未登録ユーザー、エージェントユーザーなど)、その添付は
どこからも参照されないまま残り、掃除が回収する。

### アバターの配信

アバターだけは `/api/avatar/<キー>` から**認証なしで**読める。自身をIdPとして使う
OIDC クライアントへ `picture` クレームで渡すURLの実体で、クライアントは Devuntu の
ログインセッションを持たないため。

公開されるのは「今この瞬間 `user.image` から参照されているキー」だけで、同じ添付でも
お知らせ本文の画像やリンクウィジェットのアイコンは引き続きログイン必須の `/api/upload` から
しか読めない。キーは保存ごとに変わる uuidv7 なので推測はできない。

IdP から取り込む側は、リンクローカル(`169.254.0.0/16` / `fe80::/10`)とクラウドの
インスタンスメタデータへは名前解決の結果を見て繋がない。自ホスト運用でIdPが
プライベートネットワークに居る構成は許可したままにしてある。

裏を返すと、**IdP が申告した画像URLからプライベートネットワークへの GET は通る**。
名前解決から実際の接続までの間に応答が変わるDNSリバインディングも塞いでいない。
取得した応答は保存時に画像として検証されるため内容の持ち出しは成立しない。

### ボード削除

ボードを消すと、そのボードの添付はレコードを Cascade に任せず、削除の直前に紐付け
(`attachment.boardId`)だけを外して行を残す。レコードごと消すと、続く実体の削除に失敗した分が
DBから辿れなくなり、DBを起点にする掃除の対象から永久に外れてしまうため。行が残っていれば、
本文が消えて参照が外れた添付として次の掃除が拾い直し、実体ごと回収して収束する。

回収されるまでの間 `boardId` は null(全ログインユーザーへ配信してよい扱い)になるが、キーは
推測できず、URLを知っているのは削除したボードのメンバーだけなので閲覧の実害は無い。

記録の無い実体を棚卸ししたい場合は、S3 の一覧と突き合わせる。

```sh
pnpm s3:backup
docker compose exec -T db psql -U devuser -d devuntu -Atc 'SELECT key FROM attachment' | sort > /tmp/db-keys
jq -r '.[].key' backup/s3_YYYYMMDD_HHMMSS/manifest.json | sort > /tmp/s3-keys
comm -13 /tmp/db-keys /tmp/s3-keys
```

差分に出たキーが、記録の無い実体の候補になる。ただし実体を書いてからレコードを作るため、
**掃除やアップロードの最中に取ったバックアップでは正常な行も差分に出る**。消す前に作成日時を確かめること。

### インデックスを足す目安

掃除用のインデックスは一部のテーブルにだけ置いている(`ticket_activity.createdAt` /
`git_check_suite.updatedAt` / `upload_nonce.expiresAt` / `agent_run.(runnerId, startedAt)`)。`session` / `verification` / `oauth_*` には置いていない。
特に `session.expiresAt` はセッション更新のたびに書き換わる列で、最も書き込みの多いテーブルに索引を足すと
1時間に1回のスキャンと引き換えにリクエストごとの索引更新を招くため、あえて入れていない。

`oauth_access_token` が100万行を超える、または `maintenance sweep finished` の間隔が
目に見えて延びた場合に `@@index([expiresAt])` の追加を検討する。その際は
`CREATE INDEX CONCURRENTLY` を使うが、Prisma のマイグレーションはトランザクションで走るため
生成された SQL の手直しが要る。
