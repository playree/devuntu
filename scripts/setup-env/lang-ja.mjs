/** setup-env の表示メッセージ(日本語)。キーは `lang-en.mjs` と揃える */
export const ja = {
  usage: `使い方: node scripts/setup-env/index.mjs [オプション]

  --dir <path>   生成先ディレクトリ(既定: カレントディレクトリ)
  --dry-run      ファイルへ書かず、生成内容を表示するだけ
  --force        上書きの確認を省略する
  --no-backup    既存ファイルの .bak を作らない
  --help         この使い方を表示する
`,
  no_tty: '対話的な入力ができません(TTY が割り当てられていません)。',
  no_tty_hint: '次のいずれかで実行してください。',
  aborted: '中断しました(ファイルは作成していません)',

  // プロンプト
  required: '必須です',
  treated_as: (value) => `${value} として扱います`,
  answer_yes_no: 'y または n で答えてください',
  choice_number: '番号',
  choose_number: (max) => `1〜${max} の番号で選んでください`,

  // 既存ファイルの読み込み
  path_is_directory: (file) => `${file} がディレクトリになっています。`,
  path_is_directory_hint: 'Docker が設定ファイルの代わりに作ったディレクトリです。削除してから実行し直してください。',
  cannot_read: (file) => `${file} を読めません。ファイルの所有者を確認してください`,
  s3_config_broken: (file) => `${file} が JSON として読めないため、内容を作り直します`,

  intro_title: 'Devuntu セルフホストの設定ファイルを作成します',
  intro_out_dir: (dir) => `生成先: ${dir}`,
  intro_enter_default: 'Enter だけを押すと [] 内の既定値を使います。秘密の値は既定値をマスクして表示します',
  intro_loaded_existing: '既存の .env.docker を読み込み、現在値を既定値にしています',

  // セクション(`.env.docker` の見出しにも使う)
  section_basic: '基本',
  section_database: 'データベース',
  section_auth: '認証',
  section_mail: 'メール',
  section_storage: 'オブジェクトストレージ',
  section_integrations: '外部サービス連携',
  section_integrations_optional: '外部サービス連携(任意)',
  section_notify: '通知',
  section_notify_optional: '通知(任意)',
  section_maintenance: 'メンテナンス',
  section_host_info: 'ホスト情報の表示',
  section_output: '生成内容',
  section_extras: 'その他',

  // A. 基本
  q_default_locale: 'デフォルトロケール (DEFAULT_LOCALE)',
  q_default_locale_help: (choices) => `${choices} から選びます`,
  q_default_timezone: 'デフォルトタイムゾーン (DEFAULT_TIMEZONE)',

  // B. データベース
  q_use_bundled_db: 'compose.yaml に同梱の db サービスを使いますか?',
  q_db_user: 'DBユーザー (POSTGRES_USER)',
  q_db_password: 'DBパスワード (POSTGRES_PASSWORD)',
  generated_default: '自動生成した値を既定にしています',
  q_db_name: 'DB名 (POSTGRES_DB)',
  db_password_changed: [
    'postgres は初回起動時にボリュームを初期化するため、既に docker compose up 済みの環境では',
    'パスワードを変えても DB 側の実際のパスワードは変わらず、認証エラーになります。',
    '変更する場合はボリューム(pgdata)を作り直すか、DB 側で ALTER USER してください。',
  ],
  q_database_url: '接続URL (DATABASE_URL)',
  q_database_url_help: '外部のPostgreSQLへ接続します',
  bundled_db_removable: '同梱の db サービスを使わない場合、compose.yaml の db サービスは削除してかまいません',

  // C. 認証
  q_better_auth_url: '公開するベースURL (BETTER_AUTH_URL)',
  q_better_auth_url_help: '実際に配信するオリジンと完全に一致させます(不一致だとサインインのPOSTが拒否されます)',
  q_regenerate_auth_secret: 'BETTER_AUTH_SECRET を再生成しますか?(既存の全セッションが無効になります)',
  auth_secret_generated: 'BETTER_AUTH_SECRET を自動生成しました',
  q_disable_password_auth: 'パスワード認証を無効にし、メールOTPのみでサインインしますか? (DISABLE_PASSWORD_AUTH)',
  q_two_fa_required: '2要素認証を必須にしますか? (TWO_FA_REQUIRED)',
  two_fa_note: '利用者は初回サインイン後に2要素認証の設定が必須になります',
  q_oidc_dcr: 'MCPサーバーを公開しますか? (OIDC_DCR_ENABLED)',

  // D. メール
  otp_only_note: 'パスワード認証を無効にしたため、メールOTPが唯一のサインイン手段になります',
  q_mail_send: '送信方式 (MAIL_SEND)',
  mail_debug_label: 'debug(送信せずサーバーログへ出力)',
  mail_none_label: '設定しない(メールを送信しない)',
  mail_none_warn: 'メールを送信しないと誰もサインインできません。試用であれば debug を選んでください',
  q_mail_none_confirm: 'それでもメールを設定しませんか?',
  q_mail_from: '送信元アドレス (MAIL_FROM)',
  q_sendgrid_api_key: 'SendGrid APIキー (SENDGRID_API_KEY)',
  sendgrid_key_prefix: 'SendGrid のAPIキーは通常 SG. で始まります',
  q_sendmail_path: 'sendmail のパス (SENDMAIL_PATH)',
  sendmail_warn: [
    'アプリのコンテナ(node:24-slim ベース)に sendmail は入っていません。',
    'コンテナ内で解決できる場合のみ動きます。通常は smtp / sendgrid を選んでください',
  ],
  q_smtp_host: 'SMTPホスト (SMTP_HOST)',
  q_smtp_port: 'SMTPポート (SMTP_PORT)',
  q_smtp_secure: 'SSL/TLSで接続しますか? (SMTP_SECURE)',
  q_smtp_ignore_tls: 'TLSを使わずに接続しますか? (SMTP_IGNORE_TLS)',
  q_smtp_auth: 'SMTP認証(ユーザー・パスワード)を設定しますか?',
  q_smtp_user: 'SMTP認証ユーザー (SMTP_USER)',
  q_smtp_pass: 'SMTP認証パスワード (SMTP_PASS)',
  mail_debug_note: 'OTP は送信されず、サーバーログ(docker compose logs devuntu)に出力されます',

  // E. オブジェクトストレージ
  q_use_bundled_s3: 'compose.yaml に同梱の SeaweedFS を使いますか?',
  q_s3_endpoint: 'S3 APIのエンドポイント (S3_ENDPOINT)',
  q_s3_region: 'リージョン (S3_REGION)',
  q_s3_bucket: 'バケット名 (S3_BUCKET)',
  q_s3_bucket_help: '存在しない場合は初回アップロード時に自動作成されます',
  q_s3_access_key: 'アクセスキー (S3_ACCESS_KEY_ID)',
  q_s3_secret_key: 'シークレットキー (S3_SECRET_ACCESS_KEY)',
  s3_config_same_values: '同じ値で seaweedfs-s3.json も生成します',

  // F. 任意項目
  q_google: 'Googleアカウント連携を設定しますか?',
  q_client_id: (key) => `クライアントID (${key})`,
  q_client_secret: (key) => `クライアントシークレット (${key})`,
  q_google_sign_in: 'Googleサインイン(アカウントでのログイン)に使いますか?',
  q_google_allowed_domains: 'サインインを許可するドメイン (GOOGLE_ALLOWED_DOMAINS)',
  q_google_allowed_domains_help: 'カンマ区切り。未設定だと全ドメインのサインインが拒否されます',
  google_calendar_only: 'カレンダー連携のみ有効です(Googleサインインは全ドメイン拒否になります)',
  google_redirect_uris: 'Google Cloud 側に登録するリダイレクトURI:',
  q_slack: 'Slack連携を設定しますか?',
  q_slack_bot_token: 'Botトークン (SLACK_BOT_TOKEN)',
  slack_bot_token_prefix: 'Botトークンは通常 xoxb- で始まります',
  q_slack_team_id: 'ワークスペースID (SLACK_TEAM_ID)',
  slack_team_id_prefix: 'ワークスペースIDは通常 T で始まります',
  q_slack_signing_secret: '署名シークレット (SLACK_SIGNING_SECRET)',
  q_gitlab: 'GitLab連携(MRの状態・CIの反映)を設定しますか?',
  q_gitlab_urls: 'GitLab のインスタンスの URL (GITLAB_URLS)',
  q_gitlab_urls_help: 'カンマ区切りで複数指定できます(例: https://gitlab.com,https://git.example.com/gitlab)',
  gitlab_webhook_note: 'Webhook の URL とトークンは、ボード設定の「Git連携」でプロジェクトごとに表示・設定します',
  q_web_push: 'Webプッシュ通知を有効にしますか?',
  q_regenerate_vapid: 'VAPID鍵を再生成しますか?(既存の購読がすべて無効になります)',
  vapid_regenerated: 'VAPID鍵を再生成しました',
  vapid_generated: 'VAPID鍵を自動生成しました',
  q_change_vapid_subject: 'プッシュサービスからの連絡先を既定から変更しますか?',
  q_vapid_subject: '連絡先 (VAPID_SUBJECT)',
  q_vapid_subject_help: 'mailto: または https: で始めます',
  web_push_needs_https: 'HTTPSでないとブラウザがプッシュ通知の購読を許可しません',

  // G. / H. 引き継ぎと未知キー
  key_not_writable: (key, reason) => `${key} は${reason}。このキーは残せません(元の値は退避ファイルに残ります)`,
  carried_keys: (keys) => `次の設定は尋ねずに現在値を引き継ぎます: ${keys}`,
  unknown_keys: (keys) => `このスクリプトが管理していないキーが既存の .env.docker にあります: ${keys}`,
  q_keep_unknown_keys: 'そのまま残しますか?',
  key_reason: (key, reason) => `${key} は${reason}。`,
  no_backup_would_lose: '--no-backup では上書きと同時にこの値が失われるため中断しました。',
  no_backup_would_lose_hint: '--no-backup を外して実行するか、該当キーを先に手で退避してください。',

  // 確認
  build_failed: (message) => `設定を組み立てられませんでした: ${message}`,
  env_docker_header: [
    'Devuntu セルフホスト用の環境変数(docker compose run --rm tools setup-env で再生成できる)',
    '全変数の一覧は docs/environment-variables.md を参照',
  ],
  env_docker_extras: 'その他(このスクリプトが管理していない設定)',
  env_db_header: [
    'compose.yaml の db サービス(postgres)が読む変数',
    '外部のPostgreSQLを使う場合、このファイルと db サービスは不要',
  ],
  diff_title: '.env.docker の差分',
  diff_summary: (added, changed, removed) => `追加 ${added} / 変更 ${changed} / 削除 ${removed}`,
  diff_added: (keys) => `追加: ${keys}`,
  diff_changed: (keys) => `変更: ${keys}`,
  diff_removed: (keys) => `削除: ${keys}`,
  dry_run_done: '--dry-run のためファイルは作成していません',
  overwrite_files: (files) => `次のファイルを上書きします: ${files}`,
  q_write: '書き出しますか?',

  // 書き出し
  cannot_write_dir: (dir) => `${dir} へ書き込めません。ディレクトリの所有者を確認するか、sudo を付けて実行してください`,
  write_failed: (message) => `書き出しに失敗しました: ${message}`,
  created: '作成しました:',
  backed_up: (suffix) => `上書き前の内容は *.${suffix}.bak に退避しました`,
  next_steps: '次の手順:',
  next_open_start: (url) => `  ${url}/start  を開いて最初の管理者を登録する`,

  // env-file.mjs
  value_has_newline: '改行を含む値は env ファイルへ書けません',
  value_has_single_quote: "シングルクォート(')を含む値は env ファイルへ書けません",
  value_ends_with_backslash: 'バックスラッシュで終わる値は env ファイルへ書けません',

  // spec.mjs
  vapid_generate_failed: 'VAPID鍵の生成に失敗しました(P-256のJWKに x / y / d が揃っていません)',
  invalid_url_example: 'URLとして解釈できません(例: https://devuntu.example.com)',
  invalid_url: 'URLとして解釈できません',
  invalid_url_value: (value) => `URLとして解釈できません: ${value}`,
  http_or_https: 'http:// または https:// で指定してください',
  no_query_or_fragment: 'クエリやフラグメントは含められません',
  origin_only: (origin) => `パスは含められません(オリジンのみ指定してください: ${origin})`,
  http_insecure: 'http:// のため Cookie に Secure が付かず、Webプッシュ通知もブラウザに拒否されます',
  invalid_database_url: '接続URLとして解釈できません(例: postgresql://user:pass@host:5432/dbname?schema=public)',
  postgresql_scheme: 'postgresql:// で指定してください',
  invalid_timezone: 'タイムゾーン名として解釈できません(例: Asia/Tokyo)',
  one_of: (choices) => `${choices} のいずれかを指定してください`,
  invalid_email: 'メールアドレスの形式で指定してください',
  invalid_port: '1〜65535 の整数で指定してください',
  min_integer: (min) => `${min} 以上の整数で指定してください`,
  allowed_domains_required: '最低1件必要です(未設定だと全ドメインのサインインが拒否されます)',
  invalid_domain: (domain) => `ドメイン名として解釈できません: ${domain}`,
  at_least_one: '最低1件必要です',
  invalid_gitlab_url: (value) => `http(s):// で始まる、認証情報やクエリの無い URL で指定してください: ${value}`,
  vapid_subject_scheme: 'mailto: または https: で始めてください',
}
