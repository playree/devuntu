import { DefaultLocaleItems } from '.'

// アルファベット順
export const ja: DefaultLocaleItems = {
  account: 'アカウント',
  action: '操作',
  add_client: 'クライアント追加',
  add_user: 'ユーザー追加',
  admin: '管理者',
  admin_regist: '管理者登録',
  auth: '認証',
  auth_ng: '認証NG',
  back: '戻る',
  cancel: 'キャンセル',
  client_id: 'クライアントID',
  client_name: 'クライアント名',
  client_secret: 'クライアントシークレット',
  confirm_deletion: '削除確認',
  confirmed: '確認した',
  created_at: '作成日時',
  dashboard: 'ダッシュボード',
  delete: '削除',
  delete_user: 'ユーザー削除',
  edit: '編集',
  edit_user: 'ユーザー編集',
  email: 'Eメール',
  error: 'エラー',
  google_signin: 'Googleでサインイン',
  is_admin: '管理者',
  last_login: '最終ログイン',
  next: '次へ',
  oidc_clients: 'OIDCクライアント',
  ok: 'OK',
  otp: 'OTP',
  passkey_signin: 'パスキーでサインイン',
  password: 'パスワード',
  password_reset: 'パスワード再設定',
  password_score: 'パスワードスコア',
  password_score_required: '${score}以上が必要',
  redirect_uri: 'リダイレクトURI',
  reload: 'リロード',
  resend: '再送',
  send: '送信',
  signin: 'サインイン',
  signout: 'サインアウト',
  skip_consent: '同意スキップ',
  trust_device: 'このデバイスを信頼する',
  twofa: '2要素認証',
  twofa_enable: '2要素認証有効化',
  updated_at: '更新日時',
  user_manage: 'ユーザー管理',
  username: 'ユーザー名',
  welcome: 'ようこそ',

  msg_added_target: '${target} を追加しました。',
  msg_confirm_deletion: '${target} を削除します。',
  msg_deleted_target: '${target} を削除しました。',
  msg_email_not_verified: 'Eメールが検証されていません。\n一度、Eメールでログインしてください。',
  msg_enter_otp: 'Eメールに届いた認証コードを入力してください。',
  msg_invalid_email_or_password: 'Eメールまたはパスワードが違います。',
  msg_otp_sent: '認証コードを送信しました。',
  msg_updated_target: '${target} を更新しました。',
  msg_user_not_exist: 'ユーザーが存在しません。',

  mail_otp_body: `Eメール認証の為の認証コードを発行しました。

認証コード: \${otp}

有効期限: 5分間

※心当たりのない場合は、このメールを破棄してください。

@\${hostname} #\${otp}
`,
  mail_otp_subject: '[${appname}] Eメール認証OTP : ${otp}',

  '@invalid_email': 'Eメールフォーマット不正',
  '@invalid_password': '半角英数記号8～20文字',
  '@invalid_username': '2～20文字',
  '@required_field': '必須入力項目',
}
