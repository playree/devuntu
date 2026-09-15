- [前提](#前提)
- [構成](#構成)
- [1. compose.yaml の配置](#1-composeyaml-の配置)
- [2. 設定ファイルの作成](#2-設定ファイルの作成)
  - [スクリプトを使わない場合](#スクリプトを使わない場合)
- [3. 起動](#3-起動)
- [4. 初期セットアップ(最初の管理者を作る)](#4-初期セットアップ最初の管理者を作る)
- [5. サインインの確認](#5-サインインの確認)
- [外部サービス連携(任意)](#外部サービス連携任意)
  - [Googleアカウント連携](#googleアカウント連携)
  - [Slack連携](#slack連携)
  - [Webプッシュ通知](#webプッシュ通知)
  - [MCP サーバーの公開](#mcp-サーバーの公開)
  - [AIエージェント](#aiエージェント)
- [アップデート](#アップデート)
  - [compose.yaml を新しいものへ差し替える場合](#composeyaml-を新しいものへ差し替える場合)
- [困ったとき](#困ったとき)

# 導入(セルフホスト)

Docker Compose で Devuntu を立ち上げるまでの手順。運用開始後のバックアップ手順は
[operations.md](operations.md)、開発環境の構築は [development.md](development.md) を参照。

## 前提

- Docker / Docker Compose が動くホスト。`compose.yaml` が `env_file` の `required: false` を使うため
  **Docker Compose は v2.24 以降**が必要
- **メモリは最低 2GB、推奨 4GB**。内訳の目安はアプリ本体 250〜600MB(画像変換とワーカーを含む)、
  `db` 150〜300MB、`s3` 150〜400MB で、これにホストOSと Docker デーモンの 300〜500MB が乗る。
  公開済みイメージを pull する前提の値で、ホスト上で自前ビルドする場合は別途 4GB 以上必要
- 利用者に見せる URL を決めてあること(`BETTER_AUTH_URL` に設定する)
- **HTTPS で公開する場合は DNS とリバースプロキシ(またはロードバランサー)**。`compose.yaml` が公開するのは
  HTTP の 3000 番だけで、TLS 終端もホスト名の振り分けも行わない。`https://` の `BETTER_AUTH_URL` を
  そのまま開けるようにするには、決めたホスト名を DNS で解決させ、TLS を終端するプロキシから 3000 番へ
  転送する構成が必要。画像アップロードが 5MB まで通るよう、**リクエストボディの上限を 6MB 以上**に
  広げておくこと(nginx の `client_max_body_size` は既定 1MB)
- **メール送信手段**。本手順の最小構成(`DISABLE_PASSWORD_AUTH=true`)ではメールOTPがサインインの唯一の手段になるため、
  SendGrid / sendmail / SMTP のいずれかを用意する。試用のみであれば `MAIL_SEND=debug` でサーバーログに
  OTP を出力させることもできる

## 構成

`compose.yaml` は3つのサービスを定義している。

| サービス  | イメージ                 | 役割                             | ホストへの公開ポート       |
| --------- | ------------------------ | -------------------------------- | -------------------------- |
| `devuntu` | `playree/devuntu:latest` | アプリ本体(Next.js)              | `3000`(全インターフェース) |
| `db`      | `postgres:18`            | データベース                     | `127.0.0.1:5432`           |
| `s3`      | `chrislusf/seaweedfs`    | アップロード画像の保存先(S3互換) | `127.0.0.1:8333`           |

`devuntu` から `db` / `s3` へは Compose のネットワーク内(`db:5432` / `s3:8333`)で到達するため、
**`db` と `s3` のホスト公開は運用上は不要**。ホストから直接繋ぐ用途(開発時の psql や、リポジトリを
clone している環境での `pnpm s3:backup`)のために loopback だけへ公開している。不要なら
`compose.yaml` の該当 `ports` を削除してよい。公開ホストで全インターフェースへ bind すると、
PostgreSQL とオブジェクトストレージへ外部から直接到達できてしまうので戻さないこと。

リバースプロキシを同じホストに置く場合は、`devuntu` の `ports` も `127.0.0.1:3000:3000` に絞って
プロキシ経由だけに限定できる。

`tools` は設定ファイルの生成とバックアップ/リストアを行う使い捨てサービスで、`profiles: ['tools']` が
付いているため `docker compose up` では起動しない([operations.md](operations.md#toolsサービス))。

永続データは名前付きボリューム `pgdata` / `seaweeddata` に入る。

## 1. compose.yaml の配置

任意のディレクトリ(例: `/opt/devuntu`)に、このリポジトリの `compose.yaml` を置く。
アプリはイメージから起動するため、リポジトリ全体の clone は不要。**必要なファイルはこの1つだけ**で、
残りは次の手順で生成する。

```text
/opt/devuntu/
├── compose.yaml       # 配置する
├── .env.docker        # 手順2で生成される
├── .env.db            # 手順2で生成される
└── seaweedfs-s3.json  # 手順2で生成される
```

書き込めるディレクトリを使うこと。設定ファイルは実行したユーザーの所有で作られる。

## 2. 設定ファイルの作成

`compose.yaml` を置いたディレクトリで次を実行する。対話形式で設定を尋ね、3つのファイルを生成する。

```sh
docker compose run --rm tools setup-env
```

| 生成されるファイル  | 内容                                     | 読むサービス |
| ------------------- | ---------------------------------------- | ------------ |
| `.env.docker`       | アプリの環境変数                         | `devuntu`    |
| `.env.db`           | PostgreSQL の初期化パラメータ            | `db`         |
| `seaweedfs-s3.json` | オブジェクトストレージの S3 アクセスキー | `s3`         |

生成されるファイルはいずれも資格情報を含むため `0600` で作られる。`s3` サービスは root で動くため
`0600` のままマウントして読める。

尋ねられるのは最小構成(ロケール / DB / 公開URL / メール / オブジェクトストレージ)で、
外部サービス連携などの任意項目は「設定しますか?」で分岐する。既に設定ファイルがある場合は
現在値を既定値として提示するので、Enter を押し続ければ内容は変わらない(設定変更や項目追加にも使える)。
上書き前の内容は `<ファイル名>.<日時>.bak` へ退避される。

次の設定は対話では尋ねない。変更する場合は `.env.docker` を直接編集する(変数名と既定値は
[environment-variables.md](environment-variables.md) を参照)。既存の設定ファイルに値があれば、
再実行しても現在値を引き継ぐ。

- 検索エンジンへのインデックス(`SEARCH_ENGINE_INDEXING`)
- 連携元 Devuntu との連携(`MAIN_DEVUNTU_*`)
- ホスト情報の表示(`LINODE_*`)
- ログレベル・セッション期間・自動メンテナンス(`LOG_LEVEL` / `SESSION_*` /
  `MCP_REFRESH_TOKEN_EXPIRES_IN` / `NOTIFY_WORKER_ENABLED` / `MAINTENANCE_*`)

このスクリプトが自動でやること。手で書くと食い違いに気づきにくい箇所を引き受けている。

- `BETTER_AUTH_SECRET` の生成(`openssl rand -base64 32` 相当)
- `BETTER_AUTH_URL` の検証。**実際に配信するオリジンと完全に一致していないとサインインなどの
  POST が origin チェックで拒否される**ため、パスやクエリを含む入力は受け付けず、末尾スラッシュは落とす
- DBパスワードの生成と、`.env.db` の `POSTGRES_*` から `DATABASE_URL` を組み立てること
- S3 のシークレットキーを `.env.docker` と `seaweedfs-s3.json` の両方へ同じ値で書くこと
  (外部のS3を使う場合は、その資格情報を `seaweedfs-s3.json` へ複製せず、同梱の SeaweedFS 用に
  別の値を生成する)
- VAPID 鍵の生成(Webプッシュ通知を有効にした場合)

全変数の一覧とデフォルト値は [environment-variables.md](environment-variables.md) を参照。
`DISABLE_PASSWORD_AUTH=false`(パスワード認証あり)を選んだ場合の 2要素認証の挙動は
[screens.md](screens.md#アクセス制御の仕組み) を参照。

> ⚠️ **DBパスワードは初回起動より後には変えられない。** postgres は最初の `docker compose up` で
> ボリュームを初期化し、そのときのパスワードを保持する。後から `.env.db` を書き換えても DB 側は
> 変わらず、アプリが認証エラーになる。変更するにはボリューム(`pgdata`)を作り直すか、
> DB 側で `ALTER USER` する。

### スクリプトを使わない場合

`.env.docker` は手で書いてもよい。最小構成は次のとおり。

```sh
# 基本
DEFAULT_LOCALE=ja
DEFAULT_TIMEZONE=Asia/Tokyo
DATABASE_URL=postgresql://devuser:<DBパスワード>@db:5432/devuntu?schema=public

# 認証
BETTER_AUTH_URL=https://devuntu.example.com
BETTER_AUTH_SECRET=<openssl rand -base64 32 の出力>
DISABLE_PASSWORD_AUTH=true

# メール(メールOTPのサインインに必要)
MAIL_SEND=smtp
MAIL_FROM=devuntu@example.com
SMTP_HOST=<SMTPホスト>
SMTP_PORT=25

# オブジェクトストレージ
S3_ENDPOINT=http://s3:8333
S3_BUCKET=devuntu
S3_ACCESS_KEY_ID=<アクセスキー>
S3_SECRET_ACCESS_KEY=<シークレットキー>
```

この場合は `.env.db` と `seaweedfs-s3.json` も自分で用意する。**`.env.db` が無いと `db` サービスが
起動せず、`seaweedfs-s3.json` が無いと `s3` サービスの起動がエラーになる。**

```sh
# .env.db
POSTGRES_USER=devuser
POSTGRES_PASSWORD=<DBパスワード>   # DATABASE_URL と揃える
POSTGRES_DB=devuntu
```

`seaweedfs-s3.json`(JSON にコメントは書けないので、次の内容をそのまま保存する)。

```json
{
  "identities": [
    {
      "name": "devuntu",
      "credentials": [{ "accessKey": "<アクセスキー>", "secretKey": "<シークレットキー>" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
```

`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` をこの JSON と揃える。バケットは初回アップロード時に
自動作成されるため事前作業は不要。検索エンジンへのインデックスは**既定で拒否**しているので、
社外へ公開して検索結果に載せたい場合のみ `SEARCH_ENGINE_INDEXING=true` を設定する。

## 3. 起動

```sh
docker compose up -d
```

`db` と `s3` の healthcheck が通ってから `devuntu` が起動する。
DB マイグレーションは `docker/docker-entrypoint.sh` が起動時に `prisma migrate deploy` を実行するため、
**手動でのマイグレーションは不要**(アップデート時も同じ)。

起動を確認する。

```sh
docker compose logs -f devuntu
curl -s http://localhost:3000/api/health
# => {"status":"ok","timestamp":"..."}
```

## 4. 初期セットアップ(最初の管理者を作る)

ブラウザで `<BETTER_AUTH_URL>/start` を開き、最初の管理者を登録する。

- この画面はユーザーが1人も居ないときだけ開ける。1人でも登録されると `/` へリダイレクトされ、
  以後は使えない。**起動したらまず実施する**
- 入力するのは名前とメールアドレス。`DISABLE_PASSWORD_AUTH=false` の場合のみパスワード欄も表示される
- 以後のユーザー追加は管理者が `/admin/users` から行う

## 5. サインインの確認

`<BETTER_AUTH_URL>/auth/signin` から、登録したメールアドレスでOTPサインインできることを確認する。

メールが届かない場合は `MAIL_SEND` 周りの設定を見直す。`MAIL_SEND=debug` にしていると
実際には送信されず、OTP はサーバーログ(`docker compose logs devuntu`)に出力される。

## 外部サービス連携(任意)

いずれも環境変数を設定して `devuntu` を再起動する。加えて必要な操作は連携ごとに異なる。

### Googleアカウント連携

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を設定する。

`GOOGLE_ALLOWED_DOMAINS`(カンマ区切り)の扱いは用途で分かれる。

- **Googleサインインを使うなら最低1件必要。** 未設定だと許可ドメインが空のまま全ドメインのサインインが
  拒否される(サインイン時に必ず許可リストとの突き合わせが行われる)
- `/account` からのカレンダー連携だけであればドメインチェックは効かないため省略できる

Google 側のコールバックURLには**次の2つ**を登録する。

```text
<BETTER_AUTH_URL>/api/auth/callback/google
<BETTER_AUTH_URL>/api/auth/callback/google-account
```

サインイン用と、カレンダー連携用(refresh token を取るための別プロバイダ)で `providerId` が異なる。
後者を登録しないと `/account` のカレンダー連携で `redirect_uri_mismatch` になる。

そのうえで、管理者が `/admin/settings` で「Googleアカウント連携」を有効化する。この設定が効くのは
アカウント連携とカレンダー機能で、**サインイン画面の「Googleでサインイン」は環境変数だけで決まる**。
許可グループを指定すると、そのグループのメンバーだけがアカウント連携を行える(空なら全ユーザー)。

**カレンダー機能(`/cal`)は Google アカウント連携が前提**で、未連携のユーザーには案内だけが表示される。

### Slack連携

`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_BOT_TOKEN` / `SLACK_TEAM_ID` / `SLACK_SIGNING_SECRET`
を設定し、管理者が `/admin/settings` で「Slack連携」を有効化する。Googleと同じく許可グループを指定できる。
Slack App のマニフェストは `slack/manifest.yaml`。

Slack DM 通知(メンション / 担当者の変更 / エージェントの実行結果)、ボードごとのチャンネル通知、
Slack に貼られたチケットURLの展開が使えるようになる。
手順の詳細は [notifications.md](notifications.md#slack通知の前提) を参照。

### Webプッシュ通知

ブラウザ / スマートフォンの通知として受け取る場合は VAPID 鍵が必要。未設定なら購読の UI ごと
出ないので、使わない場合は省略してよい。

`docker compose run --rm tools setup-env` の「Webプッシュ通知を有効にしますか?」で `y` を選ぶと鍵を生成する。
プッシュサービスからの連絡先(`VAPID_SUBJECT`)も同じ流れで設定できる(既定は `mailto:${MAIL_FROM}`)。

手で用意する場合は次のワンライナーで生成し、出力の 2 行を `.env.docker` へ追記して再起動する。

```sh
docker compose run --rm --entrypoint node tools -e "const {generateKeyPairSync}=require('node:crypto');const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const j=privateKey.export({format:'jwk'});const b=(v)=>Buffer.from(v,'base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+j.d)"
```

> ⚠️ `web-push` の `generateVAPIDKeys()` はイメージ内では使えない。standalone ビルドでは
> `web-push` がサーバーチャンクへバンドルされ、`node_modules` に実体が残らないため
> `require('web-push')` が `MODULE_NOT_FOUND` になる。

- **鍵を入れ替えると既存の購読はすべて無効になる**(登録済みの端末へ送ると `401` になり、
  利用者は再登録が必要)。生成し直すのは鍵が漏れた場合だけにする
- 通知は HTTPS のオリジンでのみ動く(`localhost` は例外)
- **iPhone / iPad はホーム画面に追加したアプリから開いた場合だけ**通知を受け取れる
  (詳細は [notifications.md](notifications.md#ios--ipados-の制約))

### MCP サーバーの公開

`OIDC_DCR_ENABLED=true` を設定すると、AIエージェントなどの MCP クライアントが
`<BETTER_AUTH_URL>/api/mcp` へ動的クライアント登録(DCR)で接続できるようになる。
環境変数だけで有効になり、`/admin/settings` での操作は不要。
詳細と運用上の注意は [mcp-server.md](mcp-server.md) を参照。

### AIエージェント

`/admin/settings` ではなく `/admin/agents` から設定する。管理者がエージェントユーザーを作り、
接続用の長期トークンを発行する。
利用者のマシンで AIエージェントのCLI を自動起動させる仕組みは [agent-runner.md](agent-runner.md) を参照。

### コマンド実行

画面からあらかじめ定義した処理を実行する機能。**既定では無効**で、次の3つが揃って初めて動く。

1. `COMMAND_EXEC_ENABLED=true`
2. 定義ファイルの配置(`COMMAND_DEF_DIR` の直下、既定 `/app/config/commands`)
3. `/admin/commands` でのコマンドごとの有効化

定義ファイルと SSH の鍵はコンテナへ read-only でマウントする。`compose.yaml` の `devuntu` サービスへ:

```yaml
volumes:
  - type: bind
    source: ./config
    target: /app/config
    read_only: true
```

```text
/opt/devuntu/config/
├── commands/
│   ├── web01.yaml      # コマンドの定義(1ファイル1ホスト)
│   └── db01.yaml
└── ssh/
    ├── ops_ed25519     # 秘密鍵(0600)。パスフレーズ無し
    └── known_hosts     # 接続先のホスト鍵。登録が無いホストへは接続できない
```

devuntu が載っている**ホスト側**で実行したい場合は、コンテナからホストへ SSH する構成になるので、
`devuntu` サービスに `extra_hosts` を足す。

```yaml
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

リバースプロキシを挟む場合は、実行ログの配信(SSE)を**バッファリングしない**設定にする
(nginx なら該当ロケーションで `proxy_buffering off;`)。

定義ファイルの書き方・鍵の準備・権限の考え方は [command-exec.md](command-exec.md) を参照。

## アップデート

```sh
docker compose pull
docker compose up -d
```

新しいイメージで起動する際、entrypoint が `prisma migrate deploy` を実行して DB を追随させる。
**アップデート前にバックアップを取得する**こと([operations.md](operations.md))。

### compose.yaml を新しいものへ差し替える場合

`db` サービスの `POSTGRES_*` は `compose.yaml` へ直接書く形をやめ、`.env.db` から読むようにした。
新しい `compose.yaml` をコピーしたら `.env.db` が必要になる。

**既存の postgres ボリュームは初期化時のパスワードを保持している**ため、`POSTGRES_PASSWORD` には
今の `DATABASE_URL` に入っているパスワード(差し替え前の `compose.yaml` に書いてあった値)を入れる。
`docker compose run --rm tools setup-env` は差し替え前の `compose.yaml` が残っていればそこから、
無ければ `.env.docker` の `DATABASE_URL` から既定値を引くので、Enter を押し続ければ揃う。

使い捨てコンテナは `tools` サービス1本に統合した(`0.7.2` 以降)。`0.7.1` 以前の `compose.yaml` にあった
`s3-tools` は `tools s3-backup` / `tools s3-restore` に変わるため、**cron などに
`docker compose run --rm s3-tools` を登録している場合は書き換える**
([operations.md](operations.md#toolsサービス))。

## 困ったとき

| 症状                                     | 見るところ                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| アプリが起動しない                       | `docker compose logs devuntu`。マイグレーション失敗なら `DATABASE_URL` と `db` の状態     |
| `env file ... not found` で落ちる        | `.env.docker` / `.env.db` が無い。`docker compose run --rm tools setup-env` で生成する    |
| `bind source path does not exist`        | `seaweedfs-s3.json` が無い。同じく `tools setup-env` で生成する                           |
| `db` が起動しない・認証エラーになる      | `.env.db` の `POSTGRES_PASSWORD` と `DATABASE_URL` のパスワードが一致しているか           |
| サインインの操作が失敗する               | `BETTER_AUTH_URL` が実際のオリジンと一致しているか                                        |
| `/start` が `/` へリダイレクトされる     | 既にユーザーが登録済み。`/auth/signin` からサインインする                                 |
| OTP メールが届かない                     | `MAIL_SEND` / `MAIL_FROM` と送信手段の設定。`debug` の場合はログに出力される              |
| 画像がアップロードできない・表示されない | `s3` サービスの状態と `S3_*` の設定、`seaweedfs-s3.json` との突き合わせ                   |
| カレンダーが使えない                     | Googleアカウント連携が有効か(`/admin/settings`)、利用者本人が `/account` で連携しているか |
