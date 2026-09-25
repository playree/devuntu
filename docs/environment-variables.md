- [基本](#基本)
- [認証](#認証)
- [通知](#通知)
- [メンテナンス](#メンテナンス)
- [メンテナンスモード](#メンテナンスモード)
- [リモート実行](#リモート実行)
- [メール](#メール)
- [オブジェクトストレージ](#オブジェクトストレージ)
- [Linode](#linode)
- [Debug](#debug)
- [補足](#補足)

# 環境変数

環境変数の定義元は `src/lib/env-util.ts`。参照時も同ファイルの `envu` を利用する。

セルフホスト用の `.env.docker` は `docker compose run --rm tools setup-env` で対話生成できる
([installation.md](./installation.md#2-設定ファイルの作成))。尋ねるのは起動に必要な変数で、
デバッグ用・内部変数と、導入時に判断の必要がない変数は尋ねない。尋ねない変数はこのファイルを見て
`.env.docker` へ直接書く(既に値があれば再実行しても引き継がれる)。

## 基本

| 変数名                       | 説明                                                            | 必須 | デフォルト        |
| ---------------------------- | --------------------------------------------------------------- | ---- | ----------------- |
| `NEXT_PUBLIC_APP_NAME`       | アプリ名(クライアント公開)                                      |      | `Devuntu`         |
| `DATABASE_URL`               | DB(PostgreSQL) の接続パス                                       | 〇   | -                 |
| `DEFAULT_LOCALE`             | デフォルトロケール                                              |      | -                 |
| `DEFAULT_TIMEZONE`           | サーバー側の判定に使う既定のタイムゾーン(IANA 名)               |      | `Asia/Tokyo`      |
| `LOG_LEVEL`                  | ログレベル                                                      |      | `info`            |
| `DEV_ALLOWED_ORIGINS`        | `next dev` で許可する追加オリジン(カンマ区切り)。開発時のみ有効 |      | -                 |
| `SEARCH_ENGINE_INDEXING`     | 検索エンジンにインデックスさせるか                              |      | `false`           |
| `SEARCH_ENGINE_ROBOTS_ALLOW` | `robots.txt` でクロールを許可するか                             |      | `false`           |
| `RELEASE_NOTES_REPO`         | ダッシュボードのリリースノートの取得元(GitHub の `owner/repo`)  |      | `playree/devuntu` |
| `RELEASE_NOTES_LIMIT`        | リリースノートの最大取得件数(1〜100)                            |      | `20`              |

`DEV_ALLOWED_ORIGINS` だけは例外で、`src/lib/env-util.ts` には定義していない。参照元の `next.config.ts` は
Next の起動前に評価されるため `envu` を解決できず、`process.env` を直接読んでいる。

リリースノートは `RELEASE_NOTES_REPO` の GitHub Releases を取得する。フォークして運用する場合は
自分のリポジトリを指定すると、上流ではなく自分のリリースノートが表示される。`owner/repo` 形式以外(URL や `.` / `..` を含むものなど)や、
`RELEASE_NOTES_LIMIT` の範囲外の値は読み取り時にエラーにしている。件数の上限100は GitHub API の `per_page` の上限に合わせている。

真偽値の変数は `true` / `false`(大文字小文字は問わない)だけを受け付ける。`1` や綴り違いは
黙って既定の反対側へ倒れると気づけないため、読み取り時にエラーにしている。
数値の変数も同様に、整数でない値(`abc` / `1.5` など)や範囲外の値は読み取り時にエラーにしている。

`DEFAULT_TIMEZONE` は、利用者やエージェントのランナーにタイムゾーンが設定されていないときに、
サーバー側の判定(エージェントの稼働時間帯・処理上限のリセット時刻、ダッシュボードの期限間近)で使う。
`Asia/Tokio` のような解釈できない名前は読み取り時にエラーにしている。

検索エンジン向けの設定は2つに分かれている。どちらも**既定は拒否**で、社内向けに立てた環境を
うっかり検索結果へ載せないため、明示的に `true` にしたときだけ許可する。

- `SEARCH_ENGINE_INDEXING` : インデックスの可否。拒否時は `<meta name="robots">`(`src/app/layout.tsx`)と
  `X-Robots-Tag` ヘッダ(`src/proxy.ts`)が `noindex, nofollow` になる
- `SEARCH_ENGINE_ROBOTS_ALLOW` : `/robots.txt`(`src/app/robots.ts`)でクロールを許可するか。
  `SEARCH_ENGINE_INDEXING=true` は載せる意思表示なので、この変数によらずクロール許可になる

| `SEARCH_ENGINE_INDEXING` | `SEARCH_ENGINE_ROBOTS_ALLOW` | `/robots.txt`                      | `noindex` |
| ------------------------ | ---------------------------- | ---------------------------------- | --------- |
| `false`(既定)            | `false`(既定)                | `Disallow: /`                      | あり      |
| `false`                  | `true`                       | `Allow: /`(`/api/` `/cal/` は除外) | あり      |
| `true`                   | -                            | `Allow: /`(`/api/` `/cal/` は除外) | なし      |

2つに分けているのは、`Disallow: /` だけではインデックスを防げないため。クロールを拒否すると
ページ本体が取得されず `noindex` が読まれないので、外部リンクから発見された URL は
「robots.txt によりブロックされましたが、インデックスに登録しました」として検索結果に残り続ける。
消したい場合は `SEARCH_ENGINE_ROBOTS_ALLOW=true` にしてクロールを通し、`noindex` を読ませる
(Search Console でインデックスが消えたのを確認したら `false` へ戻してもよい)。

`X-Robots-Tag` が付くのは Proxy が通常処理を継続したページ応答だけ。`/api/`・拡張子を含むパス・
Server Action(`next-action` ヘッダ)は matcher の対象外で、認証リダイレクトと管理者拒否の rewrite は
ヘッダを付ける前に返る。これらを追わないのは、`/api/` と `/cal/` はクロール許可時も `/robots.txt` で
`Disallow` しており、拡張子を含むパスは検索結果に載る HTML ではないため。静的アセットまで Proxy を
通すと全リクエストでセッション取得が走る点も避けている。

値の変更は再起動で反映される。空き時間の共有(`/cal/[id]`)は共有URLを知る人だけが見る画面なので、
これらの設定に関わらず常に `noindex` のままにしている。

## 認証

| 変数名                         | 説明                                       | 必須 | デフォルト        |
| ------------------------------ | ------------------------------------------ | ---- | ----------------- |
| `BETTER_AUTH_URL`              | 運用するベースの URL                       | 〇   | -                 |
| `BETTER_AUTH_SECRET`           | Better Auth 用シークレット                 | 〇   | -                 |
| `SESSION_EXPIRES_IN`           | セッション有効期間(秒)                     |      | `432000`(5日)     |
| `SESSION_FRESH_AGE`            | セッション fresh 期間(秒)。`0` で無効      |      | `86400`(1日)      |
| `TWO_FA_REQUIRED`              | 2要素認証を必須にするか                    |      | `true`            |
| `DISABLE_PASSWORD_AUTH`        | パスワード認証を無効化                     |      | `false`           |
| `OIDC_DCR_ENABLED`             | 動的クライアント登録を有効化               |      | `false`           |
| `MCP_REFRESH_TOKEN_EXPIRES_IN` | MCP リフレッシュトークンの有効期間(秒)     |      | `15552000`(180日) |
| `MAIN_DEVUNTU_URL`             | 連携元 Devuntu の URL                      |      | -                 |
| `MAIN_DEVUNTU_CLIENT_ID`       | 連携元クライアントID                       |      | -                 |
| `MAIN_DEVUNTU_CLIENT_SECRET`   | 連携元クライアントシークレット             |      | -                 |
| `GOOGLE_CLIENT_ID`             | Google OAuth クライアントID                |      | -                 |
| `GOOGLE_CLIENT_SECRET`         | Google OAuth クライアントシークレット      |      | -                 |
| `GOOGLE_ALLOWED_DOMAINS`       | サインインを許可するドメイン(カンマ区切り) |      | -                 |
| `SLACK_CLIENT_ID`              | Slack OAuth クライアントID                 |      | -                 |
| `SLACK_CLIENT_SECRET`          | Slack OAuth クライアントシークレット       |      | -                 |
| `SLACK_BOT_TOKEN`              | Slack Bot トークン(`xoxb-`)                |      | -                 |
| `SLACK_TEAM_ID`                | Slack ワークスペースID(`T...`)             |      | -                 |
| `SLACK_SIGNING_SECRET`         | Slack リクエスト署名シークレット           |      | -                 |

`TWO_FA_REQUIRED=false` にすると 2要素認証を行わない。パスワード認証時に OTP 入力へ遷移せず、
過去に 2FA を有効化した利用者もパスワードのみでサインインする(サインイン時の 2FA チャレンジ自体を
行わないため)。`DISABLE_PASSWORD_AUTH=true`(メールOTPでのサインイン)の場合はこの値に関わらず
2要素認証の経路を通らない。

`SESSION_FRESH_AGE` は、パスワード変更など重要な操作に「サインインからの経過時間」の上限を課す。
`0` にするとこのチェックを行わない(`src/lib/auth/session-fresh.ts`)。

`GOOGLE_ALLOWED_DOMAINS` は **Googleサインインを使う場合は最低1件必要**。未設定だと許可ドメインが空になり、
すべてのドメインのサインインが拒否される。`/account` からのカレンダー連携だけであれば省略できる。

## 通知

| 変数名                  | 説明                                               | 必須 | デフォルト            |
| ----------------------- | -------------------------------------------------- | ---- | --------------------- |
| `NOTIFY_WORKER_ENABLED` | 通知の配信ワーカーを動かすか                       |      | `true`                |
| `VAPID_PUBLIC_KEY`      | Web プッシュの VAPID 公開鍵(base64url)             |      | -                     |
| `VAPID_PRIVATE_KEY`     | Web プッシュの VAPID 秘密鍵(base64url)             |      | -                     |
| `VAPID_SUBJECT`         | プッシュサービスからの連絡先(`mailto:` / `https:`) |      | `mailto:${MAIL_FROM}` |

`NOTIFY_WORKER_ENABLED=false` にすると通知はキュー(`notify_outbox`)へ溜まるだけで配信されない。
通知が届かない原因が投入側か配信側かを切り分けるときに使う。詳細は
[通知の実装詳細](./notifications.md#通知キューと配信ワーカー)を参照。

VAPID 鍵は Web プッシュ通知を使う場合のみ必要で、**公開鍵と秘密鍵の両方**が揃っていないと
購読 UI ごと出ない。生成手順は [installation.md](./installation.md#webプッシュ通知) を参照。

> ⚠️ 公開鍵も `NEXT_PUBLIC_*` にはしない。配布物は事前ビルド済みのイメージで、`NEXT_PUBLIC_*` は
> ビルド時にインライン化されるため起動時に渡した値が入らない(実行時に Server Action で返している)。

## メンテナンス

| 変数名                               | 説明                                             | 必須 | デフォルト |
| ------------------------------------ | ------------------------------------------------ | ---- | ---------- |
| `MAINTENANCE_WORKER_ENABLED`         | 定期メンテナンスを動かすか                       |      | `true`     |
| `MAINTENANCE_ATTACHMENT_MODE`        | 未参照の添付の扱い(`off` / `dry-run` / `delete`) |      | `delete`   |
| `MAINTENANCE_ATTACHMENT_GRACE_HOURS` | 添付が削除対象になるまでの猶予(時間)             |      | `24`       |
| `AGENT_RUN_RETENTION_DAYS`           | エージェントの実行履歴を残す期間(日)             |      | `90`       |
| `AGENT_RUN_KEEP`                     | ランナー1台あたりに残す実行履歴の件数            |      | `500`      |

期限切れのセッション・検証値・OAuthトークンや、古いエージェント実行履歴を定期的に消す。
止めても表示や操作には影響しない(消えないだけ)。詳細は
[自動メンテナンス](./operations.md#自動メンテナンス)を参照。

`MAINTENANCE_ATTACHMENT_MODE` は添付の削除だけを別に制御する。オブジェクトストレージからの削除は
掃除の中で唯一の取り消せない操作なので、`dry-run` で対象をログに出して確かめてから `delete` へ
切り替えられるようにしている。`off` は添付の掃除だけを止め、他の掃除は動かしたままにする。

`MAINTENANCE_ATTACHMENT_GRACE_HOURS` は、添付が本文の保存より先に作られることへの猶予。
作成フォームを開いたまま放置している間、その画像はまだどこからも参照されていないため、
この時間が経つまでは削除対象にしない。

実行履歴は**期間と件数の2本**で抑える。`AGENT_RUN_RETENTION_DAYS` を過ぎた履歴を消したうえで、
期間内でも `AGENT_RUN_KEEP` を超えた古い分をランナーごとに消す。`AGENT_RUN_KEEP` には画面が出せる
件数(100)より小さい値を設定できない(設定すると起動時に落ちる)。下回ると「一覧に出ているのに
実体が無い」履歴が生まれるため。リモート実行の履歴は別の変数で、[リモート実行](#リモート実行)にある。

## メンテナンスモード

| 変数名                  | 説明                               | 必須 | デフォルト                 |
| ----------------------- | ---------------------------------- | ---- | -------------------------- |
| `MAINTENANCE_MODE_FILE` | メンテナンスモードのフラグファイル |      | `<cwd>/config/maintenance` |

前節の[メンテナンス](#メンテナンス)は期限切れ行の掃除で、こちらはリストア中に**全アクセスを遮断する
モード**。名前は似ているが別物。

**ファイルが存在すれば遮断中**として扱う。DB に持たないのは、DB リストア中(DB を作り直している間)でも
遮断が効いている必要があるため。アプリはこのパスを読むだけで、切り替えは
`pnpm maintenance on|off`(`docker compose run --rm tools maintenance on|off`)で行う。

既定値は**実行時の cwd 相対**で、切り替える側(`scripts/maintenance.mjs` の既定も cwd 相対)と同じ
ファイルを指す。Docker では `WORKDIR /app` なので `/app/config/maintenance` になり、`compose.yaml` が
ホストの `./config` を `/app/config` へマウントしているため `tools` 側と同じ実体になる。clone した環境
(`pnpm dev`)ではリポジトリ直下の `config/maintenance` になる。置き場を変える場合は
`scripts/maintenance.mjs` の `--file` も合わせる。詳細は
[メンテナンスモード](./operations.md#メンテナンスモード)を参照。

## リモート実行

| 変数名                       | 説明                                         | 必須 | デフォルト                       |
| ---------------------------- | -------------------------------------------- | ---- | -------------------------------- |
| `COMMAND_EXEC_ENABLED`       | 画面からのリモート実行を有効にするか         |      | `false`                          |
| `COMMAND_DEF_DIR`            | コマンド定義(YAML)を置くディレクトリ         |      | `/app/config/commands`           |
| `COMMAND_SSH_DIR`            | 秘密鍵 / known_hosts を置くディレクトリ      |      | `/app/config/ssh`                |
| `COMMAND_SSH_KNOWN_HOSTS`    | known_hosts のパス(ホスト側の指定が無い場合) |      | `${COMMAND_SSH_DIR}/known_hosts` |
| `COMMAND_WORKER_ENABLED`     | 実行ワーカーを動かすか                       |      | `true`                           |
| `COMMAND_MAX_CONCURRENT`     | 同時に走らせる実行の上限                     |      | `2`                              |
| `COMMAND_MAX_QUEUED`         | 順番待ちに積める実行の上限                   |      | `20`                             |
| `COMMAND_RUN_RETENTION_DAYS` | コマンドの実行履歴を残す期間(日)             |      | `90`                             |
| `COMMAND_RUN_KEEP`           | コマンド1本あたりに残す実行履歴の件数        |      | `300`                            |

あらかじめ定義しておいた処理を画面から実行する機能。`COMMAND_EXEC_ENABLED` の既定を `false` に
しているのは、この機能だけが「サーバーから対象ホストへ SSH してプロセスを起動する」という性質を
持つため。定義ファイルを置いただけでも、環境変数を入れただけでも動かない。

`COMMAND_DEF_DIR` の直下に置く YAML が実行できる処理の定義そのもの。**1 ファイルに 1 ターゲット**を書き、
ターゲットごとにファイルを分ける。接続先(`target`)は画面から作ることも変えることもできず、
`commands` の編集も `target.editable: true` を書いたファイルの、そのターゲットのオーナーに限られる
(詳しくは [command-exec.md](command-exec.md#画面から編集する))。
画面から編集する場合は `COMMAND_DEF_DIR` を書き込み可でマウントする必要がある。
既定の構成(`config` を読み取り専用でマウント)では書けない。

ファイルを追加・更新・削除すると数秒で自動的に読み直される。
読み込みに失敗したファイルは直前の内容を保持せず、そのファイルのコマンドだけが実行できない状態になる
(他のファイルのコマンドは動き続ける)。

実行を許可する相手は**ターゲットごと**に `/admin/commands` から設定する。ユーザー単位とグループ単位の
両方を指定でき、ユーザー単位には `owner`(定義の編集も可)と `member`(実行のみ)のロールが付く。
**アサインされていないターゲットは管理者でも実行できない。** 誤って全員へ開くと取り返しがつかないため、
何も設定していない状態を「誰も実行できない」側に倒してある。

`COMMAND_MAX_CONCURRENT` は同時に張る SSH 接続の数がそのまま増えるため、控えめな既定にしてある。
`COMMAND_MAX_QUEUED` とあわせて**1以上の整数**のみ受け付け、それ以外は起動時に落とす。
`COMMAND_WORKER_ENABLED` を false にすると待ち行列に積まれるだけで実行されない(切り分け用)。

実行ログは SSE(`/api/command/runs/[id]/stream`)で配信する。リバースプロキシを挟む場合は、
応答をバッファリングしないこと(nginx なら `proxy_buffering off;`)。アプリ側でも
`X-Accel-Buffering: no` と `Cache-Control: no-transform` を付けているが、
設定によっては proxy 側が優先される。

実行が失敗しても**自動では再試行しない**。副作用のあるコマンドを勝手に再実行しないためで、
アプリの再起動などで実行中のまま残った記録は、一定時間後に失敗(`interrupted`)として閉じられる。

実行履歴はエージェントと同じく**期間と件数の2本**で抑える(`COMMAND_RUN_RETENTION_DAYS` /
`COMMAND_RUN_KEEP`、どちらも1以上の整数)。履歴を消すとログ(`command_run_chunk`)も一緒に消える。
実行 1 件のログは数千行になりうるため、件数の既定はエージェントの実行履歴(`AGENT_RUN_KEEP`)より
絞ってある。実行中・順番待ちの記録は保持期間を過ぎても消さない(実行側が持ち主のため)。

`COMMAND_SSH_DIR` は秘密鍵と known_hosts の置き場所で、read-only のバインドマウントで渡す。
定義ファイルからはこの配下の**ファイル名**しか指定できず、パスやディレクトリ区切りは書けない。
`StrictHostKeyChecking=yes` で接続するため、known_hosts に登録の無いホストへは接続できない。

## メール

| 変数名             | 説明                                                                            | 必須                    | デフォルト |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------- | ---------- |
| `MAIL_SEND`        | 送信方式 `sendgrid`/`sendmail`/`smtp`/`debug`。未設定の場合はメールを送信しない |                         | -          |
| `MAIL_FROM`        | 送信元アドレス                                                                  | `MAIL_SEND` 設定時      | -          |
| `SENDGRID_API_KEY` | SendGrid APIキー                                                                | `MAIL_SEND=sendgrid` 時 | -          |
| `SENDMAIL_PATH`    | sendmail のパス                                                                 | `MAIL_SEND=sendmail` 時 | -          |
| `SMTP_HOST`        | SMTP ホスト                                                                     | `MAIL_SEND=smtp` 時     | -          |
| `SMTP_PORT`        | SMTP ポート                                                                     | `MAIL_SEND=smtp` 時     | -          |
| `SMTP_IGNORE_TLS`  | TLS を無視                                                                      |                         | `false`    |
| `SMTP_SECURE`      | SSL/TLS 接続                                                                    |                         | `false`    |
| `SMTP_USER`        | SMTP 認証ユーザー                                                               |                         | -          |
| `SMTP_PASS`        | SMTP 認証パスワード                                                             |                         | -          |

## オブジェクトストレージ

アップロードファイル(画像)の保存先。S3互換APIを話すストレージであれば何でもよいが、`compose.yaml` では OSS の [SeaweedFS](https://github.com/seaweedfs/seaweedfs) を同梱している。認証情報は `compose.yaml` と同じ階層の `seaweedfs-s3.json` で定義する。

| 変数名                 | 説明                                 | 必須 | デフォルト  |
| ---------------------- | ------------------------------------ | ---- | ----------- |
| `S3_ENDPOINT`          | S3 API のエンドポイント              | 〇   | -           |
| `S3_BUCKET`            | バケット名(存在しない場合は自動作成) |      | `devuntu`   |
| `S3_REGION`            | リージョン(SeaweedFS では任意値)     |      | `us-east-1` |
| `S3_ACCESS_KEY_ID`     | アクセスキー                         | 〇   | -           |
| `S3_SECRET_ACCESS_KEY` | シークレットキー                     | 〇   | -           |
| `S3_FORCE_PATH_STYLE`  | パススタイルのアドレッシングを強制   |      | `true`      |

## Linode

| 変数名                         | 説明                    | 必須 | デフォルト |
| ------------------------------ | ----------------------- | ---- | ---------- |
| `LINODE_ID`                    | Linode インスタンスID   |      | -          |
| `LINODE_PERSONAL_ACCESS_TOKEN` | Linode アクセストークン |      | -          |

## Debug

| 変数名               | 説明                    | 必須 | デフォルト |
| -------------------- | ----------------------- | ---- | ---------- |
| `DEBUG_LINODE_DUMMY` | Linode ダミー応答(JSON) |      | -          |

## 補足

以下はユーザーが直接設定しない内部変数。

- `BUILD_NO` : ビルド番号。`next.config.ts` の `env` で自動生成・注入される
- `NODE_ENV` : 実行環境(`development`/`production` 等)。実行環境側で設定される
