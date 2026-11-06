import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'

/** 色付けしたコードの断片。className は `tok-*`(色は globals.css)。色の無い部分は空文字 */
export type HighlightedToken = { text: string; className: string }

/** 素のテキストを表す言語名。language-data では `text` が LaTeX の拡張子として登録されているため、先に外す */
const PLAIN_TEXT_LANGUAGES = new Set(['text', 'txt', 'plain', 'plaintext'])

/**
 * コードを言語に応じて色付けする。表示側のチャンクから CodeMirror 一式を外すため、動的 import 専用。
 *
 * 編集面(codeMirrorPlugin)と同じ `@codemirror/language-data` の言語定義・パーサーを使い、
 * フェンスの言語名も編集面(MDXEditor の CodeMirrorEditor)と同じく名前・別名・拡張子の完全一致で引く。
 * (`LanguageDescription.matchLanguageName` のあいまい一致は `plaintext` などでも別の言語を引いてしまうため使わない)
 *
 * @returns 対応していない言語なら undefined
 */
export const highlight = async (code: string, language: string): Promise<HighlightedToken[] | undefined> => {
  if (PLAIN_TEXT_LANGUAGES.has(language.toLowerCase())) {
    return undefined
  }
  const description = languages.find(
    (l) => l.name === language || l.alias.includes(language) || l.extensions.includes(language),
  )
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
