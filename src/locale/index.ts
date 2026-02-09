export type LocaleItemBase =
  | 'ok'
  | 'cancel'
  | 'error'
  | 'signin'
  | 'signout'
  | 'welcome'
  | 'next'
  | 'back'
  | 'username'
  | 'email'
  | 'password'
  | 'password_score'
  | 'auth_ng'
  | 'google_signin'
  | 'otp'
  | 'auth'
  | 'send'
  | 'admin_regist'
  | 'twofa'
  | 'twofa_enable'
  | 'msg_system_error'
  | 'msg_password_score_required'
  | 'msg_invalid_email_or_password'
  | 'msg_user_not_exist'
  | 'msg_enter_otp'

export type LocaleItemError = '@required_field' | '@invalid_username' | '@invalid_email' | '@invalid_password'
export const el = (item: LocaleItemError) => item

export type LocaleItem = LocaleItemBase | LocaleItemError
export type DefaultLocaleItems = Record<LocaleItem, string>
export type LocaleItems = Partial<Record<LocaleItem, string>>
