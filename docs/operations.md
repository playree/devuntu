- [バックアップの考え方](#バックアップの考え方)
- [toolsサービス](#toolsサービス)
  - [旧イメージでの実行](#旧イメージでの実行)
- [DBバックアップ](#dbバックアップ)
- [DBリストア](#dbリストア)
- [S3バックアップ](#s3バックアップ)
  - [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)
- [S3リストア](#s3リストア)
  - [Docker環境でのS3リストア](#docker環境でのs3リストア)
  - [対で復元する手順](#対で復元する手順)
  - [ボリュームを作り直す場合](#ボリュームを作り直す場合)
- [定期実行](#定期実行)
- [自動メンテナンス](#自動メンテナンス)

# 運用(バックアップ・リストア)

導入手順は [installation.md](installation.md)、開発環境の手順は [development.md](development.md) を参照。

## バックアップの考え方

Devuntu の永続データは2箇所に分かれている。**どちらか片方だけでは復元できない**ため、必ず対で取得する。

| 対象         | 実体                                | バックアップ手段                  |
| ------------ | ----------------------------------- | --------------------------------- |
| PostgreSQL   | `db`サービス / volume `pgdata`      | [DBバックアップ](#dbバックアップ) |
| アップロード | `s3`サービス / volume `seaweeddata` | [S3バックアップ](#s3バックアップ) |

DB だけ復元しても`Attachment`レコードや`link_widget.iconPath`、チケット本文の画像 URL が実体を失う。
復元も対で行い、両方が終わるまでアプリを起動しない([対で復元する手順](#対で復元する手順))。

リポジトリを clone している環境では `package.json` のスクリプトを使える。

| コマンド          | 実体                     |
| ----------------- | ------------------------ |
| `pnpm db:backup`  | `scripts/backup-db.sh`   |
| `pnpm db:restore` | `scripts/restore-db.sh`  |
| `pnpm s3:backup`  | `scripts/backup-s3.mjs`  |
| `pnpm s3:restore` | `scripts/restore-s3.mjs` |

clone していない Docker 運用環境では、各節の「直接実行」または [`tools`サービス](#toolsサービス)を使う。

## toolsサービス

`compose.yaml` で Docker 運用している環境向けに、イメージ同梱のスクリプトを実行するための使い捨てコンテナを `tools` サービスとして定義している。設定ファイルの対話生成と S3 のバックアップ/リストアをサブコマンドで選ぶ。スクリプトはイメージに同梱されているので、**リポジトリの clone もホストへの node インストールも不要**で、`compose.yaml` があれば実行できる。

```sh
# 設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)の対話生成
docker compose run --rm tools setup-env

# S3 バックアップ
docker compose run --rm tools s3-backup

# S3 リストア
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
```

サブコマンドより後ろの引数はそのまま渡る(`tools setup-env --dry-run` など)。サブコマンド無しで実行すると一覧が出る。
`setup-env` は導入時と設定変更時のどちらでも使う。尋ねられる項目や既存ファイルの扱いは [installation.md](installation.md#2-設定ファイルの作成) を参照。

- 同梱版イメージ(`0.7.2` 以降)が前提。`0.3.1`〜`0.7.1` のイメージには S3 用の `s3-tools` サービスしか無く、`0.3.0` 以前では[旧イメージでの実行](#旧イメージでの実行)を参照する
- `profiles: ['tools']` を付けているので `docker compose up` では起動しない
- `entrypoint` を `node /app/scripts/tools.mjs` にしているので `docker-entrypoint.sh` が動かず、`prisma migrate deploy` は走らない
- 環境変数は `env_file`(`.env.docker`)から渡るので、コンテナ内の `S3_ENDPOINT` は `http://s3:8333` になる。`setup-env` は `.env.docker` を作る側なので、`required: false` を付けて「あれば読む」にしてある(Docker Compose v2.24 以降が必要)
- `compose.yaml` のあるディレクトリを `/work` へマウントして作業ディレクトリにしているため、設定ファイルの生成先も `backup/` の入出力先も `compose.yaml` と同じ階層になる。引数のパスはホストで見えるパス(`backup/...`)をそのまま書ける
- コンテナは root で動くため、`backup/` 配下の出力は root 所有になる(`setup-env` が生成する設定ファイルは、実行ユーザーが扱えるよう所有者を合わせている)
- `s3` への `depends_on` は持たない(`setup-env` は `s3` が必要とする `seaweedfs-s3.json` を作る側のため)。`s3` を止めている状態から復元するときは、先に `docker compose up -d --wait s3` で healthy まで待つ

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
一時ファイルへ出力して成功時だけ本ファイルへ移す(直接リダイレクトすると `pg_dump` 失敗時に
空や壊れた `.dump` が残り、後のリストアで事故になる)。

```sh
mkdir -p backup
OUT=backup/devuntu_$(date +%Y%m%d_%H%M%S).dump
docker compose exec -T db pg_dump -U devuser -Fc devuntu > "${OUT}.tmp" \
  && mv "${OUT}.tmp" "${OUT}" || rm -f "${OUT}.tmp"
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

**対の S3 リストアも行う場合、ここで `up -d devuntu` しない。** DB だけ戻した状態で公開すると、
S3 リストアが終わるまで実体の無い画像を参照したまま利用・更新されてしまう。
`devuntu` を止めたまま S3 リストアまで済ませ、最後に一度だけ起動する
([対で復元する手順](#対で復元する手順))。

## S3バックアップ

アップロードされた画像はオブジェクトストレージ(`s3`サービス)にしか存在せず、Docker の名前付きボリューム`seaweeddata`が消えると復旧できない。**DB バックアップと対で取得する**。

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

[`tools`サービス](#toolsサービス)の`s3-backup`サブコマンドを使う。

```sh
docker compose run --rm tools s3-backup
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

[`tools`サービス](#toolsサービス)の`s3-restore`サブコマンドにバックアップディレクトリを渡す。

```sh
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
```

### 対で復元する手順

DB と S3 を対で戻すときは、`devuntu` を止めたまま両方を復元し、最後に一度だけ起動する。

```sh
docker compose stop devuntu

# DB リストア(詳細は「DBリストア」を参照)
docker compose exec -T db dropdb -U devuser -f devuntu
docker compose exec -T db createdb -U devuser devuntu
docker compose exec -T db pg_restore -U devuser -d devuntu --no-owner --single-transaction \
  < backup/devuntu_YYYYMMDD_HHMMSS.dump

# S3 リストア
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS

docker compose up -d devuntu
```

`s3` を止めている場合は、先に `docker compose up -d --wait s3` で healthy になるまで待ってから復元する。

### ボリュームを作り直す場合

`seaweeddata`ボリュームを作り直すと`/data`のディスク消費をリセットできる。過去のバージョンで作られた volume ファイル(`*.dat`)は 1 ファイルあたり 1GiB を`fallocate`で先行確保しており、実データが数 KB でもディスクを 10GB 以上占有することがある(現行の`compose.yaml`の起動オプションでは先行確保は起きない)。

必ずバックアップを取ってから実行する。

```sh
pnpm s3:backup
pnpm db:backup

docker compose stop s3 && docker compose rm -f s3

# ボリューム名を確認してから削除する
docker volume ls --filter name=seaweeddata
docker volume rm <確認したボリューム名>

docker compose up -d --wait s3
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
```

ボリューム名の接頭辞は Compose のプロジェクト名(既定では `compose.yaml` を置いたディレクトリ名)に
なるため、`devuntu_seaweeddata` とは限らない。

`up -d` は `--wait` を付けない限り healthy を待たないため、ここでは `--wait` を付けて `s3` の
healthcheck が通ってからリストアする。

Docker 運用環境では `pnpm s3:backup` / `pnpm db:backup` の箇所も [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)・[DBバックアップ](#dbバックアップ)の直接実行コマンドに読み替える。

消費量は`docker compose exec -T s3 sh -c 'du -sk /data'`で確認できる。

## 定期実行

cron から実行する場合は、DB と S3 を続けて取得する。`compose.yaml` のあるディレクトリで実行すること。

```sh
# 毎日 3:00 に取得する例(clone していない Docker 運用環境)
0 3 * * * cd /opt/devuntu && mkdir -p backup \
  && OUT=backup/devuntu_$(date +\%Y\%m\%d_\%H\%M\%S).dump \
  && { docker compose exec -T db pg_dump -U devuser -Fc devuntu > "$OUT.tmp" || { rm -f "$OUT.tmp"; false; }; } \
  && mv "$OUT.tmp" "$OUT" \
  && docker compose run --rm tools s3-backup
```

`pg_dump` が途中で失敗したときに壊れた `.dump` を残さないよう、ここでも一時ファイル経由にしている。

アプリを動かしたまま DB と S3 を順に取得するため、**厳密には同一時点のスナップショットにはならない**。
取得の間に添付を削除する操作があると、DB ダンプ側は参照を残したまま S3 バックアップからは実体が
消えるので、復元後にその画像だけ失われる。逆に取得の間に追加されたものは S3 側にしか無い
未参照オブジェクトとして残るだけで害がないため、この順(DB → S3)にしている。
利用の少ない時間帯を選ぶ、あるいは厳密な整合性が必要なら `docker compose stop devuntu` で
書き込みを止めてから両方を取得する。

`backup/`は際限なく増えるため、世代を残す期間を決めて古いものを削除する運用を別途用意する。

バックアップの時間帯は[自動メンテナンス](#自動メンテナンス)の掃除と重ならないようにする。
DB と S3 を順に取得する間に添付が消えると、復元後にその画像だけ失われるため
(このズレ自体は手動削除でも起こるが、掃除がある分だけ当たる機会が増える)。

## 自動メンテナンス

期限切れの行と、どこからも参照されなくなった添付をアプリ自身が定期的に消す
(`src/lib/maintenance/`)。ホスト側の cron は要らない。起動の1分後に1周し、以降は1時間ごと。

| 対象                     | 消す条件                                                                    | 保持       |
| ------------------------ | --------------------------------------------------------------------------- | ---------- |
| `session`                | `expiresAt` 超過                                                            | 24時間     |
| `verification`           | `expiresAt` 超過(使われなかったOTPなど)                                     | 24時間     |
| `oauth_refresh_token`    | 期限切れ/失効済み、かつ再提示の検出期間も過ぎ、生きたアクセストークンが無い | 24時間     |
| `oauth_access_token`     | `expiresAt` または `revoked` が過去                                         | 24時間     |
| `oauth_client_assertion` | `expiresAt` 超過                                                            | なし       |
| `upload_nonce`           | `expiresAt` 超過(アップロード時の掃除の取りこぼし)                          | なし       |
| `agent_run`              | 開始が保持期間より古い + ランナーごとに新しい500件だけ残す                  | 90日       |
| `attachment` + 実体      | どの本文からも参照されていない                                              | 既定24時間 |

消す条件はすべて、書き手が「もう使わない」と記録した列に紐づけてある。
`session` を消しても MCP のトークンは失効しない(参照は `SetNull` で、Webの5日とMCPの180日は独立)。

### 添付の掃除

添付は `attachment` テーブルと実体の両方を消す。参照は外部キーではなく本文中のURLなので、
次の5箇所を見て「どこからも参照されていない」ことを確かめてから消す。

- チケット本文 / コメント本文の Markdown
- ユーザーのアバター(`user.image`)
- リンクウィジェットのアイコン(`link_widget.iconPath`)
- お知らせ本文(`key_value_store` の `DASHBOARD_ANNOUNCEMENT`)

作成フォームを開いたままの画像を消さないよう、アップロードから
`MAINTENANCE_ATTACHMENT_GRACE_HOURS`(既定24時間)は対象にしない。
本文の全走査を伴うので、この掃除だけは1日1回に絞っている。

削除は**実体 → レコードの順**。逆順にするとレコードだけ消えた場合にキーを辿れなくなり、
掃除の対象から永久に外れてしまう。この順なら実体だけ消えても次回に拾い直して収束する。

導入時は `MAINTENANCE_ATTACHMENT_MODE=dry-run` で起動し、`orphan attachment (dry-run)` に
出たキーが本当に参照されていないことを確かめてから `delete` へ切り替える。

OIDC/ソーシャルログインは、IdP のアバターを取り込むために**サインインの途中で添付を作る**。
取り込んだ後にサインインが失敗すると(未登録ユーザー、エージェントユーザーなど)、その添付は
どこからも参照されないまま残る。掃除がそのまま回収するので手当ては要らないが、
`MAINTENANCE_ATTACHMENT_MODE` を `off` / `dry-run` のままにしている環境では溜まり続ける。

### アバターの配信

アバターだけは `/api/avatar/<キー>` から**認証なしで**読める。自身をIdPとして使う
OIDC クライアントへ `picture` クレームで渡すURLの実体で、クライアントは Devuntu の
ログインセッションを持たないため。

IdP から取り込む側も、リンクローカル(`169.254.0.0/16` / `fe80::/10`)とクラウドの
インスタンスメタデータへは名前解決の結果を見て繋がない。自ホスト運用でIdPが
プライベートネットワークに居る構成は許可したままにしてある。

裏を返すと、**IdP が申告した画像URLからプライベートネットワークへの GET は通る**。
名前解決から実際の接続までの間に応答が変わるDNSリバインディングも塞いでいない。
取得した応答は保存時に画像として検証されるため内容の持ち出しは成立しないが、
IdP を信頼できない環境では `profile` スコープの付与ごと見直すこと。

公開されるのは「今この瞬間 `user.image` から参照されているキー」だけで、同じ添付でも
お知らせ本文の画像やリンクウィジェットのアイコンは従来どおりログイン必須の `/api/upload` から
しか読めない。キーは保存ごとに変わる uuidv7 なので推測はできないが、**キーを知る第三者は
誰でもそのアバターを読める**。アバターを OIDC 連携先へ渡さない運用にしたい場合は、
クライアントに `profile` スコープを与えないこと。

### ボード削除

ボードを消すと、そのボードの添付はレコードを Cascade に任せず、削除の直前に紐付け
(`attachment.boardId`)だけを外して行を残す。レコードごと消すと、続く実体の削除に失敗した分が
DBから辿れなくなり、DBを起点にする掃除の対象から永久に外れてしまうため。行が残っていれば、
本文が消えて参照が外れた添付として次の掃除が拾い直し、実体ごと回収して収束する。

`board deleted` のログに出る `attachments`(控えた件数)と `removed`(その場で消せた件数)が
食い違っていても、残りは掃除が回収するので手当ては要らない。回収されるまでの間 `boardId` は
null(全ログインユーザーへ配信してよい扱い)になるが、キーは推測できず、URLを知っているのは
削除したボードのメンバーだけなので閲覧の実害は無い。

それでも記録の無い実体を棚卸ししたい場合は S3 の一覧と突き合わせる。

```sh
pnpm s3:backup
docker compose exec -T db psql -U devuser -d devuntu -Atc 'SELECT key FROM attachment' | sort > /tmp/db-keys
jq -r '.[].key' backup/s3_YYYYMMDD_HHMMSS/manifest.json | sort > /tmp/s3-keys
comm -13 /tmp/db-keys /tmp/s3-keys
```

差分に出たキーが、記録の無い実体の候補になる。ただし**掃除やアップロードの最中に取った
バックアップでは正常な行も差分に出る**(実体を書いてからレコードを作るため)ので、
消す前に作成日時を確かめること。

### 確認と停止

```sh
# 1周ぶんの結果(手順ごとの削除件数)
docker compose logs devuntu | grep 'maintenance sweep finished'

# 失敗した手順。件数が -1 になっている手順に対応する
docker compose logs devuntu | grep 'maintenance step failed'

# 1周の削除上限に達した(消し切れていない)
docker compose logs devuntu | grep 'orphan attachment sweep capped'
```

1つの手順が失敗しても他の手順は動く。停止は3段階:

- `MAINTENANCE_WORKER_ENABLED=false` — 掃除をすべて止める
- `MAINTENANCE_ATTACHMENT_MODE=off` — 添付の掃除だけ止める(他の掃除は動く)
- `MAINTENANCE_ATTACHMENT_MODE=dry-run` — 対象をログに出すだけで消さない

### インデックスを足す目安

いまは掃除用のインデックスを置いていない。`session.expiresAt` はセッション更新のたびに
書き換わる列で、最も書き込みの多いテーブルに索引を足すと1時間に1回のスキャンと引き換えに
リクエストごとの索引更新を招くため、あえて入れていない。

`oauth_access_token` が100万行を超える、または `maintenance sweep finished` の間隔が
目に見えて延びた場合に `@@index([expiresAt])` の追加を検討する。その際は
`CREATE INDEX CONCURRENTLY` を使うが、Prisma のマイグレーションはトランザクションで走るため
生成された SQL の手直しが要る。

## 通知キューの確認

通知はキュー経由で送るため、届かない場合は行の状態を見れば止まった段階が分かる
(設計は [通知の実装詳細](./notifications.md#通知キューと配信ワーカー))。

```sh
# 試行回数を使い切った配信を数える
docker compose exec -T db psql -U devuser -d devuntu \
  -c "SELECT channel, \"lastError\", count(*) FROM notify_delivery WHERE status = 'failed' GROUP BY 1, 2"

# 打ち切って未処理へ戻した配信(再試行では直らないもの)
docker compose exec -T db psql -U devuser -d devuntu \
  -c "SELECT channel, \"lastError\", count(*) FROM notify_delivery WHERE status = 'pending' AND \"lastError\" IS NOT NULL GROUP BY 1, 2"

# 展開されないまま溜まっている発生記録
docker compose exec -T db psql -U devuser -d devuntu \
  -c "SELECT status, count(*), min(\"createdAt\") FROM notify_outbox GROUP BY 1"
```

- `notify_delivery` に `failed` が溜まっている : 試行回数を使い切っている。`lastError` の分類
  (`retryable` なら送信先の障害、`rate_limited` なら流量の超過)で切り分ける
- `notify_delivery` の `lastError` が `revoked` : 認証情報が失効している。再試行では直らないので
  `pending` のまま残り続ける(`failed` にはならない)。見る先は `channel` で変わり、`slack` なら
  `SLACK_BOT_TOKEN`、`webpush` なら VAPID 鍵(`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`)を確認する
- `notify_outbox` に `pending` が溜まっている : ワーカーが回っていない。`NOTIFY_WORKER_ENABLED` と
  起動ログ(`notify worker started`)を確認する
- `notify_outbox` の `failed` : ペイロードが壊れている(アプリのバージョン差など)。保持期間を過ぎれば自動で消える
  (保持期間は行の作成時刻ではなく `failedAt` から数えるので、ワーカーを長く止めた後に失敗した分も原因を追える)
- 送信できた配信は行ごと消えるので、**空であることが正常**。送信の記録はアプリログ側に残る
- Web プッシュが届かない場合は `web_push_subscription` に端末の行があるかを見る。
  失効(`404` / `410`)を返した購読は自動で消えるので、行が無ければ利用者に再登録してもらう

行が溜まったまま原因が解消できない場合、削除して差し支えない(通知は再送されないだけで、
チケットの内容には影響しない)。
