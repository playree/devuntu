/**
 * ロケール関連の純粋ユーティリティ。
 *
 * サーバー(`src/locale/server.ts`・ルートレイアウト)とクライアント(`src/components/locale/client.tsx`)の
 * 双方から使うため、`next/headers` などの実行環境に依存するものは持ち込まない。
 */

import acceptLanguageParser from 'accept-language-parser'

type LocaleKV = Record<string, string>
type LocaleLang = Record<string, LocaleKV>

export type LocaleConfig = {
  locales: string[]
  resources: LocaleLang
  cookie: {
    name: string
    maxAge: number
  }
}

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
  return template.replace(PLACEHOLDER, (match, key: string) =>
    // 継承プロパティ(`toString` など)を値として拾わないよう自身のキーだけを見る
    Object.hasOwn(values, key) ? String(values[key] ?? '') : match,
  )
}

/**
 * 表示するロケールを決める。Cookie の指定が最優先で、無ければ Accept-Language から選ぶ。
 *
 * 同じ入力ならサーバーとクライアントで同じ結果になるので、SSR の出力を初期描画と一致させられる。
 */
export const pickLocale = (
  localeConfig: LocaleConfig,
  defaultLocale: string,
  acceptLanguage: string | null,
  cookieLocale: string | null,
) => {
  if (cookieLocale && localeConfig.locales.includes(cookieLocale)) {
    return cookieLocale
  }

  return (
    acceptLanguageParser.pick(localeConfig.locales, acceptLanguage ?? defaultLocale, { loose: true }) || defaultLocale
  )
}
