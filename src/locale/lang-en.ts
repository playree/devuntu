import { LocaleItems } from '.'

// アルファベット順
export const en: LocaleItems = {
  account: 'Account',
  action: 'Action',
  add_client: 'Add Client',
  add_user: 'Add User',
  admin: 'Admin',
  admin_regist: 'Admin Regist',
  auth: 'Auth',
  auth_ng: 'Authentication failed',
  back: 'Back',
  cancel: 'Cancel',
  client_id: 'Client ID',
  client_name: 'Client Name',
  client_secret: 'Client Secret',
  confirm_deletion: 'Confirm deletion',
  confirmed: 'Confirmed',
  created_at: 'Created At',
  dashboard: 'Dashboard',
  delete: 'Delete',
  delete_user: 'Delete User',
  update: 'Update',
  update_user: 'Update User',
  email: 'Email',
  error: 'Error',
  google_signin: 'Sign in with Google',
  immutable: 'Immutable',
  is_admin: 'Admin',
  issuer_url: 'Issuer URL',
  last_login: 'Last Login',
  next: 'Next',
  oidc_clients: 'OIDC Clients',
  ok: 'OK',
  otp: 'OTP',
  passkey_signin: 'Sign in with Passkey',
  password: 'Password',
  password_reset: 'Password Reset',
  password_score: 'Password Score',
  password_score_required: '${score} or more required',
  redirect_uri: 'Redirect URI',
  reload: 'Reload',
  require_pkce: 'Require PKCE',
  resend: 'Resend',
  send: 'Send',
  signin: 'Sign In',
  signout: 'Sign Out',
  skip_consent: 'Skip Consent',
  trust_device: 'Trust this device',
  twofa: '2FA',
  twofa_enable: '2FA Enable',
  updated_at: 'Updated At',
  user_manage: 'User Management',
  username: 'Username',
  welcome: 'Welcome',

  msg_added_oidc_client: `Client registered.
Please copy and use the connection information above.
*The secret cannot be retrieved later.`,
  msg_added_target: 'Added ${target}.',
  msg_cannot_delete_last_admin: 'Cannot delete the last admin.',
  msg_confirm_deletion: 'Delete ${target}.',
  msg_deleted_target: 'Deleted ${target}.',
  msg_email_not_verified: 'Your email address has not been verified.\nPlease log in with your email address.',
  msg_enter_otp: 'Enter the verification code sent to your email address.',
  msg_invalid_email_or_password: 'Invalid email or password.',
  msg_otp_sent: 'Verification code sent.',
  msg_updated_target: 'Updated ${target}.',
  msg_user_not_exist: 'User does not exist.',

  mail_otp_body: `A verification code has been issued for email authentication.

Verification Code: \${otp}

Expiration time: 5 minutes

*If you do not recognize this email, please discard it.

@\${hostname} #\${otp}
`,
  mail_otp_subject: '[${appname}] Email OTP : ${otp}',

  '@invalid_email': 'Invalid email format',
  '@invalid_password': '8-20 alphanumeric characters',
  '@invalid_username': '2-20 characters',
  '@required_field': 'Required field',
}
