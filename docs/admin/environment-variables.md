- [環境変数](#環境変数)
  - [用途別の早見表](#用途別の早見表)
  - [基本](#基本)
  - [認証](#認証)
  - [通知](#通知)
  - [メンテナンス](#メンテナンス)
  - [メンテナンスモード](#メンテナンスモード)
  - [リモート実行](#リモート実行)
  - [メール](#メール)
  - [オブジェクトストレージ](#オブジェクトストレージ)
  - [Linode](#linode)

# 環境変数

> **対象**: Devuntu を導入・運用する人
>
> - 起動に必要な変数は `docker compose run --rm tools setup-env` が対話で尋ねて `.env.docker` へ書く
> - 連携を足すときは、下の[早見表](#用途別の早見表)で必要な変数を確かめる
> - 変更は `docker compose up -d` で反映する(`docker compose restart` では読み直されない)

セルフホストで設定する環境変数の一覧。定義元・参照方法・開発専用の変数(開発者向け)は
[development.md](../dev/development.md#環境変数の実装) を参照。

セルフホスト用の `.env.docker` は `docker compose run --rm tools setup-env` で対話生成できる
([installation.md](installation.md#2-設定ファイルの作成))。尋ねるのは起動に必要な変数と連携の設定で、
導入時に判断の必要がない変数は尋ねない。尋ねない変数はこのファイルを見て
`.env.docker` へ直接書く(既に値があれば再実行しても引き継がれる)。

真偽値の変数は `true` / `false`(大文字小文字は問わない)だけを受け付ける。`1` や綴り違い、
整数でない値(`abc` / `1.5` など)、範囲外の数値は読み取り時にエラーになる。

## 用途別の早見表

| やりたいこと                          | 設定する変数                                                                                                   | あわせて必要な操作                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 起動する(最小構成)                    | `DATABASE_URL` / `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` / `S3_*` / `MAIL_*`                                  | `setup-env` がすべて尋ねる                                                                                                |
| Google でサインイン・カレンダー       | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_DOMAINS`                                         | サインインは変数だけで有効。カレンダーを使うなら `/admin/settings` で有効化([手順](installation.md#googleアカウント連携)) |
| Slack 通知・リンクの展開              | `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET`(任意で `SLACK_TEAM_ID`) | Slack App の作成と `/admin/settings` での有効化([手順](notifications.md#slack-連携を使えるようにする))                    |
| Webプッシュ通知                       | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`                                                                       | `setup-env` が生成できる                                                                                                  |
| GitLab 連携                           | `GITLAB_URLS`                                                                                                  | ボード設定で対応付け([手順](git-integration.md))                                                                          |
| GitHub 連携                           | 不要                                                                                                           | ボード設定で対応付け([手順](git-integration.md))                                                                          |
| MCP クライアントのブラウザ認可(DCR)   | `OIDC_DCR_ENABLED=true`                                                                                        | トークンでの接続だけなら不要([mcp-server.md](mcp-server.md))                                                              |
| リモート実行                          | `COMMAND_EXEC_ENABLED=true`                                                                                    | 定義ファイル・SSH 鍵の配置とアサイン([command-exec.md](command-exec.md))                                                  |
| 別の Devuntu のアカウントでサインイン | `MAIN_DEVUNTU_URL` / `MAIN_DEVUNTU_CLIENT_ID` / `MAIN_DEVUNTU_CLIENT_SECRET`                                   | 連携元の Devuntu の `/admin/oidc-clients` でクライアントを登録                                                            |
| ダッシュボードに転送量を出す(Linode)  | `LINODE_ID` / `LINODE_PERSONAL_ACCESS_TOKEN`                                                                   | -                                                                                                                         |

## 基本

| 変数名                       | 説明                                                                            | 必須 | デフォルト        |
| ---------------------------- | ------------------------------------------------------------------------------- | ---- | ----------------- |
| `NEXT_PUBLIC_APP_NAME`       | アプリ名(クライアント公開)                                                      |      | `Devuntu`         |
| `DATABASE_URL`               | DB(PostgreSQL) の接続パス                                                       | 〇   | -                 |
| `DEFAULT_LOCALE`             | デフォルトロケール。`tools` の運用スクリプトの表示言語にも使う(`ja` 以外は英語) |      | -                 |
| `DEFAULT_TIMEZONE`           | タイムゾーン未設定時に使う既定のタイムゾーン(IANA 名)                           |      | `Asia/Tokyo`      |
| `LOG_LEVEL`                  | ログレベル                                                                      |      | `info`            |
| `SEARCH_ENGINE_INDEXING`     | 検索エンジンにインデックスさせるか                                              |      | `false`           |
| `SEARCH_ENGINE_ROBOTS_ALLOW` | `robots.txt` でクロールを許可するか                                             |      | `false`           |
| `RELEASE_NOTES_REPO`         | ダッシュボードのリリースノートの取得元(GitHub の `owner/repo`)                  |      | `playree/devuntu` |
| `RELEASE_NOTES_LIMIT`        | リリースノートの最大取得件数(1〜100)                                            |      | `20`              |

- **画面の表示言語**は、ロケール Cookie(`lang` で選んだもの)→ ブラウザの Accept-Language の順に
  対応言語(`ja` / `en`)から選び、どちらにも一致しないときに `DEFAULT_LOCALE` を使う(未設定なら英語)。
  利用者のロケールが決まらない通知(メール・Slack のチャンネル宛など)は `DEFAULT_LOCALE`(未設定なら `ja`)で書く
- **`DEFAULT_TIMEZONE`** は、利用者やエージェントのランナーにタイムゾーンが無いときの既定。画面の表示と
  サーバー側の判定(エージェントの稼働時間帯・上限のリセット、期限間近)の両方で使う。解釈できない名前はエラーになる
- **リリースノート**は `RELEASE_NOTES_REPO` の GitHub Releases を表示する。フォークして運用する場合は自分の
  リポジトリを指定する。`owner/repo` 形式以外(URL や `.` / `..` を含むものなど)はエラーになる

検索エンジン向けの設定は2つあり、どちらも**既定は拒否**(明示的に `true` にしたときだけ許可する)。

| `SEARCH_ENGINE_INDEXING` | `SEARCH_ENGINE_ROBOTS_ALLOW` | `/robots.txt`                      | `noindex` |
| ------------------------ | ---------------------------- | ---------------------------------- | --------- |
| `false`(既定)            | `false`(既定)                | `Disallow: /`                      | あり      |
| `false`                  | `true`                       | `Allow: /`(`/api/` `/cal/` は除外) | あり      |
| `true`                   | -                            | `Allow: /`(`/api/` `/cal/` は除外) | なし      |

`Disallow: /` だけではインデックスを防げない(クロールされないので `noindex` も読まれず、外部リンクから
見つかった URL が検索結果に残る)。既に載ってしまった URL を消したい場合は `SEARCH_ENGINE_ROBOTS_ALLOW=true`
にしてクロールを通し、Search Console で消えたのを確認したら `false` へ戻してもよい。
空き時間の共有(`/cal/[id]`)は、これらの設定に関わらず常に `noindex`。

## 認証

| 変数名                         | 説明                                                                                                                  | 必須 | デフォルト        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---- | ----------------- |
| `BETTER_AUTH_URL`              | 運用するベースの URL                                                                                                  | 〇   | -                 |
| `BETTER_AUTH_SECRET`           | Better Auth 用シークレット。GitHub / GitLab 連携の Webhook シークレットの暗号化にも使うため、変えると設定し直しが要る | 〇   | -                 |
| `SESSION_EXPIRES_IN`           | セッション有効期間(秒)                                                                                                |      | `432000`(5日)     |
| `SESSION_FRESH_AGE`            | セッション fresh 期間(秒)。`0` で無効                                                                                 |      | `86400`(1日)      |
| `TWO_FA_REQUIRED`              | 2要素認証を必須にするか                                                                                               |      | `true`            |
| `DISABLE_PASSWORD_AUTH`        | パスワード認証を無効化                                                                                                |      | `false`           |
| `OIDC_DCR_ENABLED`             | 動的クライアント登録を有効化                                                                                          |      | `false`           |
| `MCP_REFRESH_TOKEN_EXPIRES_IN` | MCP リフレッシュトークンの有効期間(秒)                                                                                |      | `15552000`(180日) |
| `MAIN_DEVUNTU_URL`             | 連携元 Devuntu の URL(別の Devuntu を IdP にしてサインインさせる場合)                                                 |      | -                 |
| `MAIN_DEVUNTU_CLIENT_ID`       | 連携元クライアントID                                                                                                  |      | -                 |
| `MAIN_DEVUNTU_CLIENT_SECRET`   | 連携元クライアントシークレット                                                                                        |      | -                 |
| `GOOGLE_CLIENT_ID`             | Google OAuth クライアントID                                                                                           |      | -                 |
| `GOOGLE_CLIENT_SECRET`         | Google OAuth クライアントシークレット                                                                                 |      | -                 |
| `GOOGLE_ALLOWED_DOMAINS`       | サインインを許可するドメイン(カンマ区切り)                                                                            |      | -                 |
| `SLACK_CLIENT_ID`              | Slack OAuth クライアントID                                                                                            |      | -                 |
| `SLACK_CLIENT_SECRET`          | Slack OAuth クライアントシークレット                                                                                  |      | -                 |
| `SLACK_BOT_TOKEN`              | Slack Bot トークン(`xoxb-`)                                                                                           |      | -                 |
| `SLACK_TEAM_ID`                | Slack ワークスペースID(`T...`)                                                                                        |      | -                 |
| `SLACK_SIGNING_SECRET`         | Slack リクエスト署名シークレット                                                                                      |      | -                 |
| `GITLAB_URLS`                  | GitLab 連携で使うインスタンスの URL(カンマ区切り)。未設定なら GitLab 連携は無効                                       |      | -                 |

- `TWO_FA_REQUIRED=false` にすると、過去に 2FA を有効化した利用者も含めてパスワードのみでサインインする
  (サインイン時の 2FA チャレンジ自体を行わない)。`DISABLE_PASSWORD_AUTH=true`(メールOTPでのサインイン)では
  この値に関わらず 2要素認証を通らない
- `SESSION_FRESH_AGE` は、パスワード変更など重要な操作に「サインインからの経過時間」の上限を課す
- `GOOGLE_ALLOWED_DOMAINS` は **Googleサインインを使う場合は最低1件必要**(未設定だと全ドメインが拒否される)

外部サービスごとの設定手順は [installation.md](installation.md#外部サービス連携任意) を参照。

## 通知

| 変数名                  | 説明                                               | 必須 | デフォルト            |
| ----------------------- | -------------------------------------------------- | ---- | --------------------- |
| `NOTIFY_WORKER_ENABLED` | 通知の配信ワーカーを動かすか                       |      | `true`                |
| `VAPID_PUBLIC_KEY`      | Web プッシュの VAPID 公開鍵(base64url)             |      | -                     |
| `VAPID_PRIVATE_KEY`     | Web プッシュの VAPID 秘密鍵(base64url)             |      | -                     |
| `VAPID_SUBJECT`         | プッシュサービスからの連絡先(`mailto:` / `https:`) |      | `mailto:${MAIL_FROM}` |

- `NOTIFY_WORKER_ENABLED=false` にすると通知はキューへ溜まるだけで配信されない(投入側と配信側の切り分け用)
- VAPID 鍵は Web プッシュ通知を使う場合のみ必要で、**公開鍵と秘密鍵の両方**が無いと購読 UI ごと出ない。
  `VAPID_SUBJECT` を省略し `MAIL_FROM` も未設定なら `mailto:devuntu@example.com` になる

鍵の生成は [installation.md](installation.md#webプッシュ通知)、通知の仕組みは [notifications.md](notifications.md) を参照。

## メンテナンス

| 変数名                               | 説明                                             | 必須 | デフォルト |
| ------------------------------------ | ------------------------------------------------ | ---- | ---------- |
| `MAINTENANCE_WORKER_ENABLED`         | 定期メンテナンスを動かすか                       |      | `true`     |
| `MAINTENANCE_ATTACHMENT_MODE`        | 未参照の添付の扱い(`off` / `dry-run` / `delete`) |      | `delete`   |
| `MAINTENANCE_ATTACHMENT_GRACE_HOURS` | 添付が削除対象になるまでの猶予(時間)             |      | `24`       |
| `AGENT_RUN_RETENTION_DAYS`           | エージェントの実行履歴を残す期間(日)             |      | `90`       |
| `AGENT_RUN_KEEP`                     | ランナー1台あたりに残す実行履歴の件数            |      | `500`      |
| `TICKET_ACTIVITY_RETENTION_DAYS`     | チケットの変更履歴を残す期間(日)                 |      | `365`      |

- 期限切れのデータや古い履歴を定期的に消す掃除。止めても表示や操作には影響しない(消えないだけ)
- 添付の削除は取り消せないため、`MAINTENANCE_ATTACHMENT_MODE=dry-run` で対象をログで確かめてから `delete` にできる
- `AGENT_RUN_KEEP` は **100 未満を指定すると起動時に失敗する**。実行履歴を減らしても、月ごとの利用量と予算上限の判定には影響しない

対象と保持の詳細は [自動メンテナンス](operations.md#自動メンテナンス)を参照(リモート実行の履歴は[リモート実行](#リモート実行)の変数)。

## メンテナンスモード

| 変数名                  | 説明                               | 必須 | デフォルト                 |
| ----------------------- | ---------------------------------- | ---- | -------------------------- |
| `MAINTENANCE_MODE_FILE` | メンテナンスモードのフラグファイル |      | `<cwd>/config/maintenance` |

- 前節の[メンテナンス](#メンテナンス)(掃除)とは別物で、リストア中に全アクセスを遮断するモード。**ファイルがあれば遮断中**
- 既定のままなら `tools maintenance on|off` と同じファイルを指す。置き場を変える場合は切り替え側の `--file` も合わせる

切り替え方とフラグの置き場は [メンテナンスモード](operations.md#メンテナンスモード)を参照。

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

- 既定は無効。`COMMAND_EXEC_ENABLED=true` に加えて、定義ファイルの配置とターゲットへのアサインが揃って初めて動く
- `COMMAND_MAX_*` と `COMMAND_RUN_*` は **1以上の整数**のみ受け付け、それ以外は起動時に失敗する。
  `COMMAND_MAX_CONCURRENT` は同時に張る SSH 接続の数になるので控えめにする
- `COMMAND_WORKER_ENABLED=false` にすると待ち行列に積まれるだけで実行されない(切り分け用)

マウントの構成とリバースプロキシの設定は [installation.md](installation.md#リモート実行)、定義ファイル・SSH の準備・
権限は [command-exec.md](command-exec.md)、履歴の掃除は [自動メンテナンス](operations.md#自動メンテナンス)を参照。

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

- `DISABLE_PASSWORD_AUTH=true` ではメールOTPがサインインの唯一の手段になるため、送信手段が必要
- `MAIL_SEND=debug` は実際には送信せず、OTP などをサーバーログに出す(試用向け)

## オブジェクトストレージ

| 変数名                 | 説明                                 | 必須 | デフォルト  |
| ---------------------- | ------------------------------------ | ---- | ----------- |
| `S3_ENDPOINT`          | S3 API のエンドポイント              | 〇   | -           |
| `S3_BUCKET`            | バケット名(存在しない場合は自動作成) |      | `devuntu`   |
| `S3_REGION`            | リージョン(SeaweedFS では任意値)     |      | `us-east-1` |
| `S3_ACCESS_KEY_ID`     | アクセスキー                         | 〇   | -           |
| `S3_SECRET_ACCESS_KEY` | シークレットキー                     | 〇   | -           |
| `S3_FORCE_PATH_STYLE`  | パススタイルのアドレッシングを強制   |      | `true`      |

- アップロードファイル(画像)の保存先。S3互換APIを話すストレージであれば何でもよく、`compose.yaml` では
  OSS の [SeaweedFS](https://github.com/seaweedfs/seaweedfs) を同梱している
- 同梱の SeaweedFS の認証情報は `compose.yaml` と同じ階層の `seaweedfs-s3.json` で定義する。
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` と揃えること

## Linode

| 変数名                         | 説明                    | 必須 | デフォルト |
| ------------------------------ | ----------------------- | ---- | ---------- |
| `LINODE_ID`                    | Linode インスタンスID   |      | -          |
| `LINODE_PERSONAL_ACCESS_TOKEN` | Linode アクセストークン |      | -          |

- 両方を設定すると、ダッシュボードに「Linode転送情報」(転送量)が表示される
