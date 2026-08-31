- [バックアップの考え方](#バックアップの考え方)
- [s3-toolsサービス](#s3-toolsサービス)
  - [旧イメージでの実行](#旧イメージでの実行)
- [DBバックアップ](#dbバックアップ)
- [DBリストア](#dbリストア)
- [S3バックアップ](#s3バックアップ)
  - [Docker環境でのS3バックアップ](#docker環境でのs3バックアップ)
- [S3リストア](#s3リストア)
  - [Docker環境でのS3リストア](#docker環境でのs3リストア)
  - [ボリュームを作り直す場合](#ボリュームを作り直す場合)
- [定期実行](#定期実行)

# 運用(バックアップ・リストア)

導入手順は [installation.md](installation.md)、開発環境の手順は [development.md](development.md) を参照。

## バックアップの考え方

Devuntu の永続データは2箇所に分かれている。**どちらか片方だけでは復元できない**ため、必ず対で取得する。

| 対象         | 実体                                | バックアップ手段                  |
| ------------ | ----------------------------------- | --------------------------------- |
| PostgreSQL   | `db`サービス / volume `pgdata`      | [DBバックアップ](#dbバックアップ) |
| アップロード | `s3`サービス / volume `seaweeddata` | [S3バックアップ](#s3バックアップ) |

DB だけ復元しても`Attachment`レコードや`link_widget.iconPath`、チケット本文の画像 URL が実体を失う。

リポジトリを clone している環境では `package.json` のスクリプトを使える。

| コマンド          | 実体                     |
| ----------------- | ------------------------ |
| `pnpm db:backup`  | `scripts/backup-db.sh`   |
| `pnpm db:restore` | `scripts/restore-db.sh`  |
| `pnpm s3:backup`  | `scripts/backup-s3.mjs`  |
| `pnpm s3:restore` | `scripts/restore-s3.mjs` |

clone していない Docker 運用環境では、各節の「直接実行」または [`s3-tools`サービス](#s3-toolsサービス)を使う。

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

## 定期実行

cron から実行する場合は、DB と S3 を続けて取得する。`compose.yaml` のあるディレクトリで実行すること。

```sh
# 毎日 3:00 に取得する例(clone していない Docker 運用環境)
0 3 * * * cd /opt/devuntu && mkdir -p backup \
  && docker compose exec -T db pg_dump -U devuser -Fc devuntu > backup/devuntu_$(date +\%Y\%m\%d_\%H\%M\%S).dump \
  && docker compose run --rm s3-tools
```

`backup/`は際限なく増えるため、世代を残す期間を決めて古いものを削除する運用を別途用意する。
