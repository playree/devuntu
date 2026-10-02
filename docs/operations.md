- [運用(バックアップ・リストア)](#運用バックアップリストア)
  - [バックアップの考え方](#バックアップの考え方)
  - [toolsサービス](#toolsサービス)
  - [DBバックアップ](#dbバックアップ)
    - [Docker環境でのDBバックアップ](#docker環境でのdbバックアップ)
  - [DBリストア](#dbリストア)
    - [Docker環境でのDBリストア](#docker環境でのdbリストア)
  - [S3バックアップ](#s3バックアップ)
    - [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)
  - [S3リストア](#s3リストア)
    - [Docker環境でのS3リストア](#docker環境でのs3リストア)
    - [対で復元する手順](#対で復元する手順)
    - [ボリュームを作り直す場合](#ボリュームを作り直す場合)
  - [一括バックアップ(DB+S3)](#一括バックアップdbs3)
    - [メンテナンスモード連動(`--maintenance`)](#メンテナンスモード連動--maintenance)
  - [一括リストア](#一括リストア)
  - [メンテナンスモード](#メンテナンスモード)
    - [フラグの実体](#フラグの実体)
    - [遮断されるもの / 生かすもの](#遮断されるもの--生かすもの)
  - [定期実行](#定期実行)
  - [自動メンテナンス](#自動メンテナンス)
    - [添付の掃除](#添付の掃除)
    - [アバターの配信](#アバターの配信)
    - [ボード削除](#ボード削除)
    - [確認と停止](#確認と停止)
  - [通知キューの確認](#通知キューの確認)

# 運用(バックアップ・リストア)

導入手順は [installation.md](installation.md)、開発環境の手順は [development.md](development.md) を参照。
スクリプトの構成・遮断や掃除の仕組み(開発者向け)は [operations-internals.md](operations-internals.md) にまとめている。

## バックアップの考え方

Devuntu の永続データは2箇所に分かれている。**どちらか片方だけでは復元できない**ため、必ず対で取得する。

| 対象         | 実体                                | バックアップ手段                  |
| ------------ | ----------------------------------- | --------------------------------- |
| PostgreSQL   | `db`サービス / volume `pgdata`      | [DBバックアップ](#dbバックアップ) |
| アップロード | `s3`サービス / volume `seaweeddata` | [S3バックアップ](#s3バックアップ) |

DB だけ復元すると、添付やリンクウィジェットのアイコン、チケット本文の画像が実体を失う。

**通常は[一括バックアップ](#一括バックアップdbs3) / [一括リストア](#一括リストア)を使う。** 対を1つの
ディレクトリにまとめるので、取り漏れも対応付けの目視も要らない。個別のコマンドは、片方だけ取り直したい
場合や既存の運用を続ける場合に使う(個別に取った場合の復元手順は[対で復元する手順](#対で復元する手順))。

リポジトリを clone している環境では `pnpm` のスクリプト(`pnpm db:backup` など)を使う。
clone していない Docker 運用環境では [`tools`サービス](#toolsサービス)を使う。どちらも同じスクリプトを実行する。

## toolsサービス

`compose.yaml` で Docker 運用している環境向けに、イメージ同梱のスクリプトを実行する使い捨てコンテナ。
設定ファイルの対話生成と DB / S3 のバックアップ・リストアをサブコマンドで選ぶ。
**リポジトリの clone もホストへの node インストールも不要**で、`compose.yaml` があれば実行できる。
`docker compose up` では起動しない。

```sh
# 設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)の対話生成
docker compose run --rm tools setup-env

# DB バックアップ / リストア
docker compose run --rm tools db-backup
docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump

# S3 バックアップ / リストア
docker compose run --rm tools s3-backup
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS

# DB と S3 をまとめてバックアップ / リストア
docker compose run --rm tools full-backup
docker compose run --rm tools full-backup --maintenance   # 取得の間だけメンテナンスモードにする
docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS

# メンテナンスモードの切り替え
docker compose run --rm tools maintenance on
docker compose run --rm tools maintenance status
docker compose run --rm tools maintenance off
```

- サブコマンドより後ろの引数はそのまま渡る(`tools setup-env --dry-run` など)。サブコマンド無しで実行すると一覧が出る
- 表示言語は `DEFAULT_LOCALE` に従い、アプリと同じ言語になる
- `setup-env` は導入時と設定変更時のどちらでも使う。尋ねられる項目や既存ファイルの扱いは [installation.md](installation.md#2-設定ファイルの作成) を参照
- 設定ファイルの生成先も `backup/` の入出力先も `compose.yaml` と同じ階層になる。引数のパスはホストで見えるパス(`backup/...`)をそのまま書ける
- 出力されるファイルの所有者は `compose.yaml` のあるディレクトリの所有者になる。以前のバージョンで作られた root 所有のバックアップは `sudo chown -R <ユーザー>: backup/` で直せる
- `db` / `s3` は自動では起動しない。止めている状態からバックアップ/リストアするときは、先に `docker compose up -d --wait db s3` で healthy まで待つ

## DBバックアップ

DB(`db`サービス)が起動している状態で実行する。`backup/`配下にタイムスタンプ付き(`.dump`/カスタム形式)で出力される。
途中で失敗した場合、壊れたファイルは残らない。

```sh
pnpm db:backup
# または
node ./scripts/backup-db.mjs
```

接続先は `DATABASE_URL` から解決するので、外部の PostgreSQL を使う構成でもそのまま動く。
ホストに `pg_dump` が無い場合は `docker compose exec -T db` 経由へ自動で切り替わるため、
postgres クライアントをホストへ入れる必要はない(どちらで実行したかは1行目に出力される)。

ただし外部の PostgreSQL を使う構成では、実行するホストに `postgresql-client` を入れる
(入っていない場合は実行前にエラーで止まる)。

### Docker環境でのDBバックアップ

[`tools`サービス](#toolsサービス)の`db-backup`サブコマンドを使う。

```sh
docker compose run --rm tools db-backup
```

`compose.yaml`と同じ階層の`backup/`に出力される。

## DBリストア

対象のダンプファイルを引数に指定する。既存 DB を作り直してから復元する。

対象 DB に他の接続が残っている場合は実行前に中断する(`--force` で無視できるが、アプリが動いたままだと
復元後も古い状態を握る)。接続を切る方法は2つある。[メンテナンスモード](#メンテナンスモード)にする(アプリは動いたままで、
利用者には案内が出る)か、`docker compose stop devuntu` で止めるか。[一括リストア](#一括リストア)は前者を自動で行う。
以下は後者の手順。

```sh
docker compose stop devuntu

pnpm db:restore backup/devuntu_YYYYMMDD_HHMMSS.dump
# または
node ./scripts/restore-db.mjs backup/devuntu_YYYYMMDD_HHMMSS.dump

docker compose up -d devuntu
```

**対の S3 リストアも行う場合、ここで `up -d devuntu` しない。**([対で復元する手順](#対で復元する手順))

### Docker環境でのDBリストア

[`tools`サービス](#toolsサービス)の`db-restore`サブコマンドにダンプファイルを渡す。
コンテナ内からは `devuntu` を止められないため、停止は先に済ませておく。

```sh
docker compose stop devuntu
docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
docker compose up -d devuntu
```

## S3バックアップ

アップロードされた画像はオブジェクトストレージ(`s3`サービス)にしか存在せず、Docker の名前付きボリューム`seaweeddata`が消えると復旧できない。**DB バックアップと対で取得する**。

S3 サービスが起動している状態で実行する。`.env`の`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`が必要。

```sh
pnpm s3:backup
# または
node ./scripts/backup-s3.mjs
```

SeaweedFS を停止せずに実行できる。`backup/`配下にタイムスタンプ付きのディレクトリが作られる。
途中で失敗した場合、欠けたバックアップは残らない。

```text
backup/s3_YYYYMMDD_HHMMSS/
├── manifest.json  … キー・Content-Type・サイズ・ETag の一覧
└── objects/       … オブジェクト本体(ファイル名=オブジェクトキー)
```

AWS S3 や Cloudflare R2 など他の S3 互換ストレージへ`S3_ENDPOINT`を向けて復元することもできる。

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

バケット(`S3_BUCKET`、既定`devuntu`)は無ければ自動作成される。

**DB リストアと挙動が異なる点**として、バックアップに含まれるキーを上書きするだけで、**ストレージ側にしか無いオブジェクトは削除しない**。同じキーへ何度実行しても安全なので、DB リストアとセットで実行してよい。

### Docker環境でのS3リストア

[`tools`サービス](#toolsサービス)の`s3-restore`サブコマンドにバックアップディレクトリを渡す。

```sh
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
```

### 対で復元する手順

**`full_*` のバックアップなら[一括リストア](#一括リストア)の1コマンドで済む。** 以下は個別に取った
`devuntu_*.dump` と `s3_*` を対で戻す場合の手順。

**DB だけ戻した状態で公開しない。** S3 リストアが終わるまで、実体の無い画像を参照したまま利用・更新されてしまう。
[メンテナンスモード](#メンテナンスモード)にしてから両方を復元し、表示を確認してから解除する
(利用者には接続拒否ではなく案内が出る)。

`maintenance on` の直後に `db-restore` を実行してよいが、`--wait` を付けること。アプリが接続を手放すまでには
数秒の遅れがあり、実行中の処理が終わるまでの時間も読めない。`--wait` は**接続数が 0 になるのを待ってから**
復元を始める(上限まで残っていれば復元せず中断する)。

```sh
# 遮断する(アプリは動いたまま。DB の接続プールも解放される)
docker compose run --rm tools maintenance on

# DB リストア(詳細は「DBリストア」を参照)
docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump --wait 60

# S3 リストア
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS

# 戻ったデータを確認してから解除する
docker compose run --rm tools maintenance off
```

`db` / `s3` を止めている場合は、先に `docker compose up -d --wait db s3` で healthy になるまで待ってから復元する。

メンテナンスモードを使わない場合は、代わりに `docker compose stop devuntu` で止めたまま両方を復元し、
最後に一度だけ `docker compose up -d devuntu` する。

### ボリュームを作り直す場合

`seaweeddata`ボリュームを作り直すと`/data`のディスク消費をリセットできる。古い起動オプションで作られた volume ファイル(`*.dat`)は 1 ファイルあたり 1GiB を`fallocate`で先行確保しており、実データが数 KB でもディスクを 10GB 以上占有することがある(現行の`compose.yaml`の起動オプションでは先行確保は起きない)。

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

- ボリューム名の接頭辞は Compose のプロジェクト名(既定では `compose.yaml` を置いたディレクトリ名)になるため、`devuntu_seaweeddata` とは限らない
- `up -d` は `--wait` を付けない限り healthy を待たないため、`--wait` を付けて `s3` が healthy になってからリストアする
- Docker 運用環境では `pnpm s3:backup` / `pnpm db:backup` を `docker compose run --rm tools s3-backup` / `docker compose run --rm tools db-backup` に読み替える
- 消費量は`docker compose exec -T s3 sh -c 'du -sk /data'`で確認できる

## 一括バックアップ(DB+S3)

DB と S3 を1つのディレクトリへまとめて取得する。**対の取り漏れと対応付けの目視が無くなる**ので、
定期実行も手動の取得もこちらを使う。

```sh
pnpm full:backup
# または
docker compose run --rm tools full-backup
```

```text
backup/full_YYYYMMDD_HHMMSS/
├── devuntu.dump   … DB(ファイル名は DATABASE_URL の DB 名)
└── s3/
    ├── manifest.json
    └── objects/
```

- 中身は個別のコマンドで取るものと同じ。DB → S3 の順で取得する
- **両方成功したときだけ** `full_*/` ができる。片方が失敗したら即中断し、壊れたバックアップも欠けた対も残らない

**対を1つにまとめるだけで、同一時点のスナップショットにはならない。** アプリを動かしたまま DB → S3 の
順に取得するため、その間に添付を削除する操作があると、DB ダンプ側は参照を残したまま S3 バックアップ
からは実体が消える(復元後にその画像だけ失われる)。取得の間に追加されたものは S3 側に余分に残るだけで害はない。
利用の少ない時間帯を選ぶか、厳密な整合性が要る場合は `--maintenance` を付ける。

### メンテナンスモード連動(`--maintenance`)

```sh
pnpm full:backup --maintenance
# または
docker compose run --rm tools full-backup --maintenance
```

取得の間だけ[メンテナンスモード](#メンテナンスモード)にして書き込みを止め、DB と S3 のずれを無くす。

1. メンテナンスモードを ON にする
2. アプリの DB 接続が 0 になるまで最大60秒待つ。上限まで残っていれば**取得せずに中断する**
3. DB → S3 の順に取得する
4. **成否に関わらず OFF に戻す**(Ctrl+C / SIGTERM で止めた場合も)。OFF に失敗した場合は非0で終了するので、手で解除する

- 開始前から ON だった場合は ON にも OFF にもしない(接続の解放待ちだけ行う)
- 取得の間は利用者に案内画面が出る。データ量に応じて時間帯を選ぶ
- フラグファイルの場所を変えている場合は `--file <path>` で合わせる(`maintenance` と同じ)

## 一括リストア

`full-backup` が出力したディレクトリを渡すと、[メンテナンスモード](#メンテナンスモード)にしてから
DB → S3 の順に復元する。**`docker compose stop devuntu` は要らない。**

```sh
pnpm full:restore backup/full_YYYYMMDD_HHMMSS
# または
docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS
```

処理の流れ。

1. 中身を検証する(`*.dump` が1件あること、S3 の manifest と実体がそろっていること)。問題があれば DB に触れる前に止まる
2. メンテナンスモードを ON にする
3. DB を復元する。**接続数が 0 になってから**始まる(最大60秒待ち、残っていれば復元せず中断する)。
   失敗したら S3 へは進まない(`--force` を付けると DB リストアへそのまま渡る)
4. S3 を復元する
5. **成否に関わらずメンテナンスモードは ON のまま**。戻ったデータを確認してから手で解除する

```sh
pnpm maintenance off
# または
docker compose run --rm tools maintenance off
```

`db` / `s3` を止めている場合は、先に `docker compose up -d --wait db s3` で healthy になるまで待つ。

## メンテナンスモード

リストア中(や整合性が要るバックアップ中)に**全アクセスを遮断する**モード。[自動メンテナンス](#自動メンテナンス)(期限切れ行の掃除)
とは別物で、こちらは運用者が明示的に入り切りする。[一括リストア](#一括リストア)と
[`full-backup --maintenance`](#メンテナンスモード連動--maintenance) は自動で入り切りする。

```sh
pnpm maintenance on      # 遮断する
pnpm maintenance status  # 今の状態を表示する
pnpm maintenance off     # 解除する

# Docker 運用環境
docker compose run --rm tools maintenance on
```

- **全員が遮断される。管理者も入れない。** 画面からは解除できず、解除はコマンドのみ
- バックグラウンドの処理(通知 / 掃除 / リモート実行)も止まる。実行中の処理は打ち切らず、終わってから止まる
- 切り替えは最大1秒で反映される

### フラグの実体

`config/maintenance` という**ファイルがあれば遮断中**として扱う。Docker 運用ではホストの `./config` が
アプリと `tools` の両方にマウントされ、clone した環境ではリポジトリ直下になるので、どちらでも
**compose.yaml の変更は要らない**。

置き場を変える場合は、アプリ側の環境変数 `MAINTENANCE_MODE_FILE` と、コマンド側の `--file` を合わせる
([環境変数](./environment-variables.md#メンテナンスモード))。

### 遮断されるもの / 生かすもの

| 対象                                  | メンテナンス中                               |
| ------------------------------------- | -------------------------------------------- |
| 画面                                  | `/maintenance` の案内を 503 で表示           |
| Server Action(画面操作)               | 503 JSON                                     |
| API(`/api/**`。MCP `/api/mcp` を含む) | 503 JSON                                     |
| `/api/health`                         | **通常どおり 200**(監視と compose の疎通)    |
| `_next/*` と `/favicon.ico`           | **通常どおり配信**(案内画面を出すために必要) |

いずれも `Retry-After` を付けて返す。`/sw.js` や `/robots.txt` のような拡張子付きのパスも遮断される。

## 定期実行

cron からは[一括バックアップ](#一括バックアップdbs3)を使う。`compose.yaml` のあるディレクトリで実行すること。

```sh
# 毎日 3:00 に取得する例(clone していない Docker 運用環境)
0 3 * * * cd /opt/devuntu && docker compose run --rm tools full-backup

# 取得の間だけメンテナンスモードにして、DB と S3 のずれを無くす場合
0 3 * * * cd /opt/devuntu && docker compose run --rm tools full-backup --maintenance
```

- 利用の少ない時間帯を選ぶ(DB と S3 のずれは[一括バックアップ](#一括バックアップdbs3)を参照)
- [自動メンテナンス](#自動メンテナンス)の掃除と時間帯を重ねない。取得の間に添付が消えると、復元後にその画像だけ失われる
- `backup/`は際限なく増えるため、世代を残す期間を決めて古いものを削除する運用を別途用意する

## 自動メンテナンス

期限切れのデータと、どこからも参照されなくなった添付をアプリ自身が定期的に消す。ホスト側の cron は要らない。
起動の1分後に1回目が動き、以降は1時間ごと(添付の掃除だけは1日1回)。
リストア中に全アクセスを遮断する[メンテナンスモード](#メンテナンスモード)とは別物で、遮断中は止まる。

| 何を                            | いつ消すか                                                                              | 変える環境変数                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| ログインセッション              | 期限切れから24時間後                                                                    | -                                                                    |
| ログイン用の確認コード(OTPなど) | 期限切れから24時間後                                                                    | -                                                                    |
| MCP 連携のトークン              | 期限切れ・失効から24時間後                                                              | -                                                                    |
| 認証・アップロードの一時データ  | 期限切れ後すぐ                                                                          | -                                                                    |
| エージェントの実行履歴          | 90日より古いもの。期間内でもランナーごとに新しい500件を超えた分                         | `AGENT_RUN_RETENTION_DAYS` / `AGENT_RUN_KEEP`                        |
| リモート実行の履歴(ログを含む)  | 90日より古いもの。期間内でもコマンドごとに新しい300件を超えた分。実行中のものは消さない | `COMMAND_RUN_RETENTION_DAYS` / `COMMAND_RUN_KEEP`                    |
| チケットの変更履歴              | 365日より古いもの。チケットを削除したときも一緒に消える                                 | `TICKET_ACTIVITY_RETENTION_DAYS`                                     |
| GitHub / GitLab 連携の CI 結果  | 更新から90日後。ボードからリポジトリの対応付けを外したときも消える                      | -                                                                    |
| 添付(画像の実体を含む)          | どこからも参照されず、アップロードから24時間たったもの                                  | `MAINTENANCE_ATTACHMENT_MODE` / `MAINTENANCE_ATTACHMENT_GRACE_HOURS` |

- エージェントの月ごとの利用量(コスト・トークン数)は消さない。実行履歴が消えても月の集計と予算上限の判定は変わらない
- 環境変数の詳細は [環境変数](./environment-variables.md#メンテナンス) と [リモート実行](./environment-variables.md#リモート実行)、
  リモート実行の履歴に残る項目は [command-exec.md](./command-exec.md#実行の記録) を参照
- 消す条件の詳細は [operations-internals.md](operations-internals.md#削除条件) を参照

### 添付の掃除

チケット・コメント・テンプレートの本文、アバター、リンクウィジェットのアイコン、お知らせのどこからも
使われていない添付を消す(画像の実体も消える)。作成フォームを開いたままの画像を消さないよう、
アップロードから `MAINTENANCE_ATTACHMENT_GRACE_HOURS`(既定24時間)は対象にしない。

導入時は `MAINTENANCE_ATTACHMENT_MODE=dry-run` で起動し、`orphan attachment (dry-run)` に
出たキーが本当に参照されていないことを確かめてから `delete` へ切り替える。

OIDC/ソーシャルログインでサインインに失敗すると(未登録ユーザーなど)、取り込んだアバターが
使われないまま残る。掃除が回収するので手当ては要らないが、`MAINTENANCE_ATTACHMENT_MODE` を
`off` / `dry-run` のままにしている環境では溜まり続ける。

### アバターの配信

> [!WARNING]
> アバター画像は `/api/avatar/<キー>` から**認証なしで**読める(Devuntu を IdP として使う OIDC クライアントへ渡すため)。
> キーは推測できないが、**キーを知る第三者は誰でもそのアバターを読める**。アバターを OIDC 連携先へ渡さない運用にしたい場合は、クライアントに `profile` スコープを与えない。
> また、IdP が申告した画像URLは取り込み時にサーバーから取得する。IdP を信頼できない環境では `profile` スコープの付与ごと見直すこと。

### ボード削除

`board deleted` のログに出る `attachments`(控えた件数)と `removed`(その場で消せた件数)が
食い違っていても、残りは掃除が回収するので手当ては要らない。

それでも記録の無い実体を棚卸ししたい場合は S3 の一覧と突き合わせる。

```sh
pnpm s3:backup
docker compose exec -T db psql -U devuser -d devuntu -Atc 'SELECT key FROM attachment' | sort > /tmp/db-keys
jq -r '.[].key' backup/s3_YYYYMMDD_HHMMSS/manifest.json | sort > /tmp/s3-keys
comm -13 /tmp/db-keys /tmp/s3-keys
```

差分に出たキーが、記録の無い実体の候補になる。ただし**掃除やアップロードの最中に取った
バックアップでは正常な行も差分に出る**ので、消す前に作成日時を確かめること。

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

`maintenance sweep finished` の間隔が目に見えて延びてきた場合は、開発者向けの
[インデックスを足す目安](operations-internals.md#インデックスを足す目安)を参照。

## 通知キューの確認

通知はキュー経由で送るため、届かない場合は行の状態を見れば止まった段階が分かる
(設計は [通知の仕組み](./notifications-internals.md#通知キューと配信ワーカー))。

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
