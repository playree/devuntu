- [運用(バックアップ・リストア・メンテナンス)](#運用バックアップリストアメンテナンス)
  - [まずはこれだけ](#まずはこれだけ)
  - [バックアップの考え方](#バックアップの考え方)
  - [toolsサービス](#toolsサービス)
  - [一括バックアップ(DB+S3)](#一括バックアップdbs3)
    - [メンテナンスモード連動(`--maintenance`)](#メンテナンスモード連動--maintenance)
  - [一括リストア](#一括リストア)
  - [定期実行](#定期実行)
  - [メンテナンスモード](#メンテナンスモード)
    - [フラグの実体](#フラグの実体)
  - [自動メンテナンス](#自動メンテナンス)
    - [添付の掃除](#添付の掃除)
    - [アバターの配信](#アバターの配信)
    - [確認と停止](#確認と停止)
  - [個別のバックアップ・リストア](#個別のバックアップリストア)
    - [DB](#db)
    - [S3(アップロード画像)](#s3アップロード画像)
    - [対で復元する手順](#対で復元する手順)
    - [ボリュームを作り直す場合](#ボリュームを作り直す場合)

# 運用(バックアップ・リストア・メンテナンス)

> **対象**: Devuntu を Docker Compose で運用している人
>
> - バックアップは `docker compose run --rm tools full-backup` の1コマンドで DB と画像をまとめて取れる
> - 復元は `full-restore` の1コマンド。復元の間は利用者に案内画面が出る(メンテナンスモード)
> - 期限切れデータの掃除はアプリが自動で行う。cron に入れるのはバックアップだけ

導入手順は [installation.md](installation.md)、通知が届かないときは [notifications.md](notifications.md#詰まったときに見る場所) を参照。
リポジトリを clone した環境での `pnpm` スクリプトや、遮断・掃除の仕組み(開発者向け)は
[operations-internals.md](../dev/operations-internals.md) にまとめている。

## まずはこれだけ

`compose.yaml` を置いたディレクトリ(例: `/opt/devuntu`)で実行する。

```sh
# バックアップ(backup/full_YYYYMMDD_HHMMSS/ ができる)
docker compose run --rm tools full-backup

# 復元(終わってもメンテナンスモードのままなので、確認してから解除する)
docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS
docker compose run --rm tools maintenance off
```

アップデートは、利用者を止めてバックアップを取り、止めたまま新しいイメージで起動する。

```sh
docker compose pull                                       # 先に新しいイメージを取得(利用者は止めない)
docker compose run --rm tools maintenance on              # 利用者を止める
docker compose run --rm tools full-backup --maintenance   # 接続が切れるのを待って取得(ON のまま)
docker compose up -d --wait                               # 新しいイメージで起動(マイグレーションも自動)
docker compose logs devuntu                               # 起動を確認してから解除する
docker compose run --rm tools maintenance off
```

メンテナンス中は管理者も画面に入れないので、解除前の確認はログと `/api/health` で行う。
取得の後も止めておくのは、取得後の書き込みがバックアップに入らず、アップデートに失敗して戻したときに失われるため。

あとは[定期実行](#定期実行)で毎日のバックアップを cron に入れ、`backup/` を別のディスクやホストへ退避すれば最低限の運用になる。

## バックアップの考え方

Devuntu の永続データは2箇所に分かれている。**どちらか片方だけでは復元できない**ため、必ず対で取得する。

| 対象         | 実体                                | 中身                                   |
| ------------ | ----------------------------------- | -------------------------------------- |
| PostgreSQL   | `db`サービス / volume `pgdata`      | チケット・ユーザー・設定などすべての行 |
| アップロード | `s3`サービス / volume `seaweeddata` | チケット本文やアバターなどの画像の実体 |

DB だけ復元すると、添付やリンクウィジェットのアイコン、チケット本文の画像が実体を失う。

**通常は[一括バックアップ](#一括バックアップdbs3) / [一括リストア](#一括リストア)を使う。** 対を1つの
ディレクトリにまとめるので、取り漏れも対応付けの目視も要らない。片方だけ取り直したい場合は
[個別のバックアップ・リストア](#個別のバックアップリストア)を使う。

## toolsサービス

イメージ同梱のスクリプトを実行する使い捨てコンテナ。設定ファイルの対話生成、バックアップ・リストア、
メンテナンスモードの切り替えをサブコマンドで選ぶ。
**リポジトリの clone もホストへの node インストールも不要**で、`compose.yaml` があれば実行できる。
`docker compose up` では起動しない。

```sh
# 設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)の対話生成
docker compose run --rm tools setup-env

# DB と S3 をまとめてバックアップ / リストア
docker compose run --rm tools full-backup
docker compose run --rm tools full-backup --maintenance   # 取得の間だけメンテナンスモードにする
docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS

# DB だけ / S3 だけのバックアップ / リストア
docker compose run --rm tools db-backup
docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
docker compose run --rm tools s3-backup
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS

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

## 一括バックアップ(DB+S3)

DB と S3 を1つのディレクトリへまとめて取得する。**対の取り漏れと対応付けの目視が無くなる**ので、
定期実行も手動の取得もこちらを使う。

```sh
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
docker compose run --rm tools maintenance off
```

`db` / `s3` を止めている場合は、先に `docker compose up -d --wait db s3` で healthy になるまで待つ。

> [!TIP]
> 本番で必要になる前に、別のホスト(または同じホストの別ディレクトリ・別プロジェクト名)へ
> `compose.yaml` を置いて `full-restore` を一度試しておくと、手順と所要時間を把握できる。

## 定期実行

cron からは[一括バックアップ](#一括バックアップdbs3)を使う。`compose.yaml` のあるディレクトリで実行すること。

```sh
# 毎日 3:00 に取得する例
0 3 * * * cd /opt/devuntu && docker compose run --rm tools full-backup

# 取得の間だけメンテナンスモードにして、DB と S3 のずれを無くす場合
0 3 * * * cd /opt/devuntu && docker compose run --rm tools full-backup --maintenance

# 14日より古いバックアップを消す例
30 3 * * * find /opt/devuntu/backup -maxdepth 1 -name 'full_*' -mtime +14 -exec rm -rf {} +
```

- 利用の少ない時間帯を選ぶ(DB と S3 のずれは[一括バックアップ](#一括バックアップdbs3)を参照)
- [自動メンテナンス](#自動メンテナンス)の掃除と時間帯を重ねない。取得の間に添付が消えると、復元後にその画像だけ失われる
- `backup/` は際限なく増えるため、世代を残す期間を決めて古いものを消す。ホストのディスク障害に備え、別のディスクやホストへもコピーしておく

## メンテナンスモード

リストア中(や整合性が要るバックアップ中)に**全アクセスを遮断する**モード。利用者には案内画面が出る。
[自動メンテナンス](#自動メンテナンス)(期限切れ行の掃除)とは別物で、こちらは運用者が明示的に入り切りする。
[一括リストア](#一括リストア)と [`full-backup --maintenance`](#メンテナンスモード連動--maintenance) は自動で入り切りする。

```sh
docker compose run --rm tools maintenance on      # 遮断する
docker compose run --rm tools maintenance status  # 今の状態を表示する
docker compose run --rm tools maintenance off     # 解除する
```

- **全員が遮断される。管理者も入れない。** 画面からは解除できず、解除はコマンドのみ
- 画面・API(MCP を含む)はすべて 503 を返す。`/api/health` だけは通常どおり 200 を返すので、監視は止めなくてよい
- バックグラウンドの処理(通知 / 掃除 / リモート実行)も止まる。実行中の処理は打ち切らず、終わってから止まる
- 切り替えは最大1秒で反映される

### フラグの実体

`config/maintenance` という**ファイルがあれば遮断中**として扱う。ホストの `./config` が
アプリと `tools` の両方にマウントされているので、**compose.yaml の変更は要らない**。

置き場を変える場合は、アプリ側の環境変数 `MAINTENANCE_MODE_FILE` と、コマンド側の `--file` を合わせる
([環境変数](environment-variables.md#メンテナンスモード))。

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
- 環境変数の詳細は [環境変数](environment-variables.md#メンテナンス) と [リモート実行](environment-variables.md#リモート実行)、
  リモート実行の履歴に残る項目は [command-exec.md](command-exec.md#実行の記録) を参照
- 消す条件の詳細は [operations-internals.md](../dev/operations-internals.md#削除条件)(開発者向け)を参照

### 添付の掃除

チケット・コメント・テンプレートの本文、アバター、リンクウィジェットのアイコン、お知らせのどこからも
使われていない添付を消す(画像の実体も消える)。作成フォームを開いたままの画像を消さないよう、
アップロードから `MAINTENANCE_ATTACHMENT_GRACE_HOURS`(既定24時間)は対象にしない。

導入時は `MAINTENANCE_ATTACHMENT_MODE=dry-run` で起動し、`orphan attachment (dry-run)` に
出たキーが本当に参照されていないことを確かめてから `delete` へ切り替える。
`off` / `dry-run` のままにしている環境では、使われなくなった添付が溜まり続ける。

ボードを削除したときのログ(`board deleted`)の `attachments` と `removed` の件数が食い違っていても、
残りはこの掃除が回収するので手当ては要らない。

### アバターの配信

> [!WARNING]
> アバター画像は `/api/avatar/<キー>` から**認証なしで**読める(Devuntu を IdP として使う OIDC クライアントへ渡すため)。
> キーは推測できないが、**キーを知る第三者は誰でもそのアバターを読める**。アバターを OIDC 連携先へ渡さない運用にしたい場合は、クライアントに `profile` スコープを与えない。
> また、IdP が申告した画像URLは取り込み時にサーバーから取得する。IdP を信頼できない環境では `profile` スコープの付与ごと見直すこと。

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
[インデックスを足す目安](../dev/operations-internals.md#インデックスを足す目安)を参照。

## 個別のバックアップ・リストア

DB だけ・S3 だけを取り直したい場合に使う。**通常は[一括バックアップ](#一括バックアップdbs3)で足りる。**
いずれも `compose.yaml` と同じ階層の `backup/` に出力され、途中で失敗した場合は壊れたファイルを残さない。

### DB

```sh
# バックアップ(backup/devuntu_YYYYMMDD_HHMMSS.dump。PostgreSQL のカスタム形式)
docker compose run --rm tools db-backup

# リストア(既存の DB を作り直してから復元する)
docker compose stop devuntu
docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
docker compose up -d devuntu
```

- 接続先は `DATABASE_URL` から解決するので、外部の PostgreSQL を使う構成でもそのまま動く
- 対象 DB に他の接続が残っている場合はリストアを実行前に中断する(`--force` で無視できるが、アプリが動いたままだと
  復元後も古い状態を握る)。コンテナ内からは `devuntu` を止められないため、停止は先に済ませておく。
  止める代わりに[メンテナンスモード](#メンテナンスモード)にしてもよい([対で復元する手順](#対で復元する手順))
- **対の S3 リストアも行う場合、DB リストアの直後に `up -d devuntu` しない。**([対で復元する手順](#対で復元する手順))

### S3(アップロード画像)

アップロードされた画像はオブジェクトストレージ(`s3`サービス)にしか存在せず、Docker の名前付きボリューム
`seaweeddata` が消えると復旧できない。**DB バックアップと対で取得する**。

```sh
# バックアップ(backup/s3_YYYYMMDD_HHMMSS/。SeaweedFS を止めずに取れる)
docker compose run --rm tools s3-backup

# リストア
docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
```

- バケット(`S3_BUCKET`、既定 `devuntu`)は無ければ自動作成される
- **DB リストアと挙動が異なる点**として、バックアップに含まれるキーを上書きするだけで、**ストレージ側にしか無いオブジェクトは削除しない**。
  同じキーへ何度実行しても安全なので、DB リストアとセットで実行してよい
- AWS S3 や Cloudflare R2 など他の S3 互換ストレージへ `S3_ENDPOINT` を向けて復元することもできる

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

# DB リストア
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

`seaweeddata` ボリュームを作り直すと、S3 のディスク消費をリセットできる。古いバージョンの `compose.yaml` で作った
ボリュームは、実データが数 KB でもディスクを 10GB 以上占有することがある(現行の `compose.yaml` では起きない)。

バックアップから復元が終わるまでの間に画像が追加されると、その画像は失われる(消すボリュームに書かれるため)。
**メンテナンスモードで書き込みを止めたまま**バックアップから復元まで行い、確認してから解除する。

```sh
# 書き込みを止める
docker compose run --rm tools maintenance on

# バックアップ(ON のまま、アプリの接続が切れるのを待ってから取得する)
docker compose run --rm tools full-backup --maintenance

docker compose stop s3 && docker compose rm -f s3

# ボリューム名を確認してから削除する
docker volume ls --filter name=seaweeddata
docker volume rm <確認したボリューム名>

docker compose up -d --wait s3
docker compose run --rm tools s3-restore backup/full_YYYYMMDD_HHMMSS/s3

# 復元の件数とログを確認してから解除する
docker compose run --rm tools maintenance off
```

- ボリューム名の接頭辞は Compose のプロジェクト名(既定では `compose.yaml` を置いたディレクトリ名)になるため、`devuntu_seaweeddata` とは限らない
- `up -d` は `--wait` を付けない限り healthy を待たないため、`--wait` を付けて `s3` が healthy になってからリストアする
- 消費量は `docker compose exec -T s3 sh -c 'du -sk /data'` で確認できる
