import { LocaleItems } from '.'

export const en: LocaleItems = {
  ok: 'OK',
  cancel: 'Cancel',
  error: 'Error',
  signin: 'Sign In',
  signout: 'Sign Out',
  welcome: 'Welcome',
  next: 'Next',
  back: 'Back',
  username: 'Username',
  email: 'Email',
  password: 'Password',
  password_score: 'Password Score',
  auth_ng: 'Authentication failed',
  google_signin: 'Sign in with Google',
  passkey_signin: 'Sign in with Passkey',
  otp: 'OTP',
  auth: 'Auth',
  send: 'Send',
  resend: 'Resend',
  admin: 'Admin',
  admin_regist: 'Admin Regist',
  twofa: '2FA',
  twofa_enable: '2FA Enable',
  password_reset: 'Password Reset',
  oidc_clients: 'OIDC Clients',
  user_manage: 'User Management',
  client_id: 'Client ID',
  client_name: 'Client Name',
  add_client: 'Add client',
  redirect_uri: 'Redirect URI',
  skip_consent: 'Skip Consent',
  reload: 'Reload',
  action: 'Action',

  msg_system_error: 'An error has occurred',
  msg_password_score_required: '${score} or more required',
  msg_invalid_email_or_password: 'Invalid email or password',
  msg_user_not_exist: 'User does not exist',
  msg_enter_otp: 'Enter the verification code sent to your email address',
  msg_otp_sent: 'Verification code sent',
  msg_added_oidc_client: 'Added OIDC client',

  mail_otp_subject: '[${appname}] 2FA OTP : ${otp}',
  mail_otp_body: `A verification code has been issued for two-factor authentication.

Verification Code: \${otp}

Expiration time: 5 minutes

*If you do not recognize this email, please discard it.

@\${hostname} #\${otp}
`,

  '@required_field': 'Required field',
  '@invalid_username': '2-20 characters',
  '@invalid_email': 'Invalid email format',
  '@invalid_password': '8-20 alphanumeric characters',
}
