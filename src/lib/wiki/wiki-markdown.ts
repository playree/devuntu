/**
 * Wiki ページ本文(Markdown)の純粋関数。MCP で本文の一部だけを読み書きするために使う
 *
 * 見出しは ATX 形式(`#`〜`######`)だけを見る。画面のエディタは ATX で書き出すので、Setext 形式は扱わない。
 * コードブロック(``` / ~~~)の中の `#` は見出しにしない。
 */

import { errValidation } from '../error'

export type MarkdownHeading = { level: number; text: string; line: number }

const HEADING_PATTERN = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

/** 本文の見出し(出現順)。`line` は 0 始まりの行番号 */
export const listMarkdownHeadings = (content: string): MarkdownHeading[] => {
  const headings: MarkdownHeading[] = []
  let fence: string | null = null
  for (const [line, text] of content.split('\n').entries()) {
    const fenceMatch = FENCE_PATTERN.exec(text)
    if (fence) {
      // 閉じるフェンスは開いたものと同じ記号で、長さが同じか長いもの
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      continue
    }
    const heading = HEADING_PATTERN.exec(text)
    if (heading) {
      headings.push({ level: heading[1].length, text: (heading[2] ?? '').trim(), line })
    }
  }
  return headings
}

/** 見出しの比較用。前後の空白と先頭の `#` を除き、大文字小文字を問わない */
const normalizeHeading = (text: string) =>
  text
    .trim()
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()

/**
 * `heading` に一致する最初の見出しの節(見出しの行から、同じか浅いレベルの次の見出しの手前まで。子見出しを含む)。
 * 見つからなければ null
 */
export const extractMarkdownSection = (content: string, heading: string): string | null => {
  const target = normalizeHeading(heading)
  const headings = listMarkdownHeadings(content)
  const index = headings.findIndex(({ text }) => normalizeHeading(text) === target)
  if (index < 0) {
    return null
  }
  const start = headings[index]
  const end = headings.slice(index + 1).find(({ level }) => level <= start.level)
  const lines = content.split('\n')
  return lines
    .slice(start.line, end?.line ?? lines.length)
    .join('\n')
    .trimEnd()
}

export type TextEdit = { oldText: string; newText: string }

const countOccurrences = (text: string, search: string): number => {
  let count = 0
  for (let at = text.indexOf(search); at >= 0; at = text.indexOf(search, at + search.length)) {
    count++
  }
  return count
}

/**
 * 部分更新(`oldText` を `newText` に置き換える)を順に当てる。後の edit は前の edit を当てた後の本文に対して探す。
 * 取り違えを防ぐため、`oldText` は本文にちょうど1回だけ現れなければならない(MCP から返すので対処をメッセージに書く)
 */
export const applyTextEdits = (content: string, edits: readonly TextEdit[]): string =>
  edits.reduce((current, { oldText, newText }, i) => {
    if (oldText === '') {
      throw errValidation(`edits[${i}].oldText must not be empty`)
    }
    const count = countOccurrences(current, oldText)
    if (count === 0) {
      throw errValidation(
        `edits[${i}].oldText was not found in the page content. Read the page again with get_wiki_page and copy the text exactly`,
      )
    }
    if (count > 1) {
      throw errValidation(
        `edits[${i}].oldText matches ${count} places in the page content. Include more surrounding text so that it matches exactly one place`,
      )
    }
    const at = current.indexOf(oldText)
    return current.slice(0, at) + newText + current.slice(at + oldText.length)
  }, content)
