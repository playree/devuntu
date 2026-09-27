/**
 * 運用ツールの表示言語を切り替える。`DEFAULT_LOCALE` が `ja` なら日本語、それ以外(未設定を含む)は英語。
 *
 * 言語は `t()` を呼んだ時点で決める。各スクリプトは import の後で `.env` を読むため、
 * import 時点で決めるとその値を拾えない。子プロセスは環境変数を引き継ぐので、親子で言語が揃う。
 *
 * アプリの `src/locale` は `@/` エイリアスや TypeScript に依存し Node ランタイムから読めないため、
 * メッセージは `messages.mjs` / `setup-env/messages.mjs` に別で持つ。
 */

/** @typedef {'ja' | 'en'} ScriptLocale */

/** @type {ScriptLocale | undefined} */
let override

/** @returns {ScriptLocale} */
export const resolveLocale = (value) => (value === 'ja' ? 'ja' : 'en')

/** 環境変数より優先する言語を決める(setup-env が既存ファイルや質問の答えから決めるため) */
export const setLocale = (value) => {
  override = value === undefined ? undefined : resolveLocale(value)
}

/** @returns {ScriptLocale} */
export const currentLocale = () => override ?? resolveLocale(process.env.DEFAULT_LOCALE)

/**
 * 言語ごとのメッセージから `t(key, ...args)` を作る。
 * メッセージは文字列(複数行を配列で渡す箇所は配列)か、埋め込む値を引数に取る関数で書く。
 *
 * @param {Record<ScriptLocale, Record<string, unknown>>} messages
 * @returns {(key: string, ...args: any[]) => any}
 */
export const createT =
  (messages) =>
  (key, ...args) => {
    const message = messages[currentLocale()][key]
    if (message === undefined) {
      return key
    }
    return typeof message === 'function' ? message(...args) : message
  }
