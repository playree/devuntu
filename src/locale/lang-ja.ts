import { DefaultLocaleItems } from '.'

export const ja: DefaultLocaleItems = {
  ok: 'OK',
  cancel: 'キャンセル',
  error: 'エラー',
  signin: 'サインイン',
  signout: 'サインアウト',
  welcome: 'ようこそ',
  next: '次へ',
  back: '戻る',
  username: 'ユーザー名',
  email: 'Eメール',
  password: 'パスワード',
  password_score: 'パスワードスコア',
  auth_ng: '認証NG',
  google_signin: 'Googleでサインイン',
  passkey_signin: 'パスキーでサインイン',
  otp: 'OTP',
  auth: '認証',
  send: '送信',
  resend: '再送',
  admin: '管理者',
  admin_regist: '管理者登録',
  twofa: '2要素認証',
  twofa_enable: '2要素認証有効化',
  password_reset: 'パスワード再設定',
  oidc_clients: 'OIDCクライアント',
  user_manage: 'ユーザー管理',
  client_id: 'クライアントID',
  client_name: 'クライアント名',
  add_client: 'クライアント追加',
  redirect_uri: 'リダイレクトURI',
  skip_consent: '同意スキップ',
  reload: 'リロード',
  action: '操作',
  confirmed: '確認した',
  confirm_deletion: '削除確認',
  password_score_required: '${score}以上が必要',

  msg_invalid_email_or_password: 'Eメールまたはパスワードが違います。',
  msg_user_not_exist: 'ユーザーが存在しません。',
  msg_enter_otp: 'Eメールに届いた認証コードを入力してください。',
  msg_otp_sent: '認証コードを送信しました。',
  msg_added_target: '${target} を追加しました。',
  msg_deleted_target: '${target} を削除しました。',
  msg_updated_target: '${target} を更新しました。',
  msg_confirm_deletion: '${target} を削除します。',

  mail_otp_subject: '[${appname}] 2要素認証OTP : ${otp}',
  mail_otp_body: `2要素認証の為の認証コードを発行しました。

認証コード: \${otp}

有効期限: 5分間

※心当たりのない場合は、このメールを破棄してください。

@\${hostname} #\${otp}
`,

  '@required_field': '必須入力項目',
  '@invalid_username': '2～20文字',
  '@invalid_email': 'Eメールフォーマット不正',
  '@invalid_password': '半角英数記号8～20文字',
}
