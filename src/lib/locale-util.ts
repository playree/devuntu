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
  /** ブラウザの言語がどのロケールにも一致しないときの表示ロケール(`DEFAULT_LOCALE` 未設定時) */
  fallbackLocale: string
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
 * どちらにも一致しなければ fallbackLocale(`pickFallbackLocale` で決めたもの)を返す。
 *
 * 同じ入力ならサーバーとクライアントで同じ結果になるので、SSR の出力を初期描画と一致させられる。
 */
export const pickLocale = (
  localeConfig: LocaleConfig,
  fallbackLocale: string,
  acceptLanguage: string | null,
  cookieLocale: string | null,
) => {
  if (cookieLocale && localeConfig.locales.includes(cookieLocale)) {
    return cookieLocale
  }

  return acceptLanguageParser.pick(localeConfig.locales, acceptLanguage ?? '', { loose: true }) || fallbackLocale
}

/**
 * `pickLocale` でブラウザの言語が一致しなかったときのロケール。
 *
 * `DEFAULT_LOCALE` を明示していればそれ(運用者が表示言語を固定できるように)、無ければ `fallbackLocale`。
 * 翻訳の欠落やリクエスト外の通知に使う既定ロケール(未設定時は `locales[0]`)とは別に決める。
 */
export const pickFallbackLocale = (localeConfig: LocaleConfig, envDefaultLocale: string | undefined) =>
  envDefaultLocale || localeConfig.fallbackLocale
