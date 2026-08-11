/** 翻訳リソースへ差し込む値。null / undefined は空文字として扱う */
export type LocaleValues = { [key: string]: string | number | null | undefined }

const PLACEHOLDER = /\$\{(\w+)\}/g

/**
 * 翻訳リソース中の `${name}` を values で置換する。
 *
 * リソースはテンプレートリテラルの構文を借りているだけなので、JS として評価はしない
 * (評価するとリソース側に任意の式を書けてしまう)。values に無いキーはそのまま残す。
 */
export const expandTemplate = (template: string, values?: LocaleValues): string => {
  if (!values) {
    return template
  }
  return template.replace(PLACEHOLDER, (match, key: string) => (key in values ? String(values[key] ?? '') : match))
}
