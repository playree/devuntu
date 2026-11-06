import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'

/** 色付けしたコードの断片。className は `tok-*`(色は globals.css)。色の無い部分は空文字 */
export type HighlightedToken = { text: string; className: string }

/**
 * コードを言語に応じて色付けする。表示側のチャンクから CodeMirror 一式を外すため、動的 import 専用。
 *
 * 編集面(codeMirrorPlugin)と同じ `@codemirror/language-data` の言語定義・パーサーを使うので、
 * フェンスの言語名(`ts` / `bash` などの別名を含む)の解釈も編集面と揃う。
 *
 * @returns 対応していない言語なら undefined
 */
export const highlight = async (code: string, language: string): Promise<HighlightedToken[] | undefined> => {
  const description = LanguageDescription.matchLanguageName(languages, language, true)
  if (!description) {
    return undefined
  }
  const support = await description.load()
  const tree = support.language.parser.parse(code)
  const tokens: HighlightedToken[] = []
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, className) => tokens.push({ text, className }),
    () => tokens.push({ text: '\n', className: '' }),
  )
  return tokens
}
