export type LocaleItemBase =
  | 'ok'
  | 'cancel'
  | 'signin'
  | 'signout'
  | 'welcome'
  | 'next'
  | 'back'
  | 'username'
  | 'email'
  | 'password'
  | 'password_score'
  | 'google_signin'
  | 'title_admin_regist'
  | 'msg_password_score_required'

export type LocaleItemError = '@required_field' | '@invalid_username' | '@invalid_email' | '@invalid_password'
export const el = (item: LocaleItemError) => item

export type LocaleItem = LocaleItemBase | LocaleItemError
export type DefaultLocaleItems = Record<LocaleItem, string>
export type LocaleItems = Partial<Record<LocaleItem, string>>
