export type LocaleItemBase = 'admin_regist'

export type LocaleItemError = '@required_field'
export const el = (item: LocaleItemError) => item

export type LocaleItem = LocaleItemBase | LocaleItemError
export type DefaultLocaleItems = Record<LocaleItem, string>
export type LocaleItems = Partial<Record<LocaleItem, string>>
