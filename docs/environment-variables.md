# 環境変数

環境変数の定義元は `src/lib/env-util.ts`。参照時も同ファイルの `envu` を利用する。

## 基本

| 変数名                 | 説明                       | 必須 | デフォルト   |
| ---------------------- | -------------------------- | ---- | ------------ |
| `NEXT_PUBLIC_APP_NAME` | アプリ名(クライアント公開) |      | `Devuntu`    |
| `DATABASE_URL`         | DB(PostgreSQL) の接続パス  | 〇   | -            |
| `DEFAULT_LOCALE`       | デフォルトロケール         |      | -            |
| `DEFAULT_TIMEZONE`     | デフォルトタイムゾーン     |      | `Asia/Tokyo` |
| `LOG_LEVEL`            | ログレベル                 |      | `info`       |

## 認証

| 変数名                       | 説明                                  | 必須 | デフォルト    |
| ---------------------------- | ------------------------------------- | ---- | ------------- |
| `BETTER_AUTH_URL`            | 運用するベースの URL                  | 〇   | -             |
| `BETTER_AUTH_SECRET`         | Better Auth 用シークレット            | 〇   | -             |
| `SESSION_EXPIRES_IN`         | セッション有効期間(秒)                |      | `432000`(5日) |
| `SESSION_FRESH_AGE`          | セッション fresh 期間(秒)             |      | `86400`(1日)  |
| `TWO_FA_REQUIRED`            | 2要素認証を必須にするか               |      | `true`        |
| `DISABLE_PASSWORD_AUTH`      | パスワード認証を無効化                |      | `false`       |
| `OIDC_DCR_ENABLED`           | 動的クライアント登録を有効化          |      | `false`       |
| `MAIN_DEVUNTU_URL`           | 連携元 Devuntu の URL                 |      | -             |
| `MAIN_DEVUNTU_CLIENT_ID`     | 連携元クライアントID                  |      | -             |
| `MAIN_DEVUNTU_CLIENT_SECRET` | 連携元クライアントシークレット        |      | -             |
| `GOOGLE_CLIENT_ID`           | Google OAuth クライアントID           |      | -             |
| `GOOGLE_CLIENT_SECRET`       | Google OAuth クライアントシークレット |      | -             |
| `GOOGLE_ALLOWED_DOMAINS`     | 許可ドメイン(カンマ区切り)            |      | -             |
| `SLACK_CLIENT_ID`            | Slack OAuth クライアントID            |      | -             |
| `SLACK_CLIENT_SECRET`        | Slack OAuth クライアントシークレット  |      | -             |
| `SLACK_BOT_TOKEN`            | Slack Bot トークン(`xoxb-`)           |      | -             |
| `SLACK_TEAM_ID`              | Slack ワークスペースID(`T...`)        |      | -             |
| `SLACK_SIGNING_SECRET`       | Slack リクエスト署名シークレット      |      | -             |

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

アップロードファイル(画像)の保存先。S3互換APIを話すストレージであれば何でもよいが、`compose.yaml` では OSS の [SeaweedFS](https://github.com/seaweedfs/seaweedfs) を同梱している。認証情報は `docker/seaweedfs-s3.json` で定義する。

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
