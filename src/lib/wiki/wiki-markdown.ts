/**
 * Wiki ページ本文(Markdown)の純粋関数。MCP で本文の一部だけを読み書きするために使う
 *
 * 見出しは ATX 形式(`#`〜`######`)だけを見る。画面のエディタは ATX で書き出すので、Setext 形式は扱わない。
 * コードブロック(``` / ~~~)の中の `#` は見出しにしない。
 */

import { errValidation } from '../error'

export type MarkdownHeading = { level: number; text: string; line: number }

/** 閉じの `#` 列は正規表現に含めない(遅延量指定子の後戻りで、空白の長い行が二乗時間になる) */
const HEADING_PATTERN = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/
/** 閉じるフェンスは記号だけの行(info string を持たない) */
const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

/** 見出しの文字列から、末尾の空白と、空白で区切られた閉じの `#` 列を取り除く(`# a#` の `#` は本文) */
const stripClosingSequence = (raw: string): string => {
  const body = raw.trimEnd()
  let end = body.length
  while (end > 0 && body[end - 1] === '#') {
    end--
  }
  if (end === body.length) {
    return body
  }
  return end === 0 || body[end - 1] === ' ' || body[end - 1] === '\t' ? body.slice(0, end).trimEnd() : body
}

/** 本文の見出し(出現順)。`line` は 0 始まりの行番号 */
export const listMarkdownHeadings = (content: string): MarkdownHeading[] => {
  const headings: MarkdownHeading[] = []
  let fence: string | null = null
  for (const [line, raw] of content.split('\n').entries()) {
    // CRLF の本文でも見出しを拾えるよう、行末の \r は見ない
    const text = raw.replace(/\r$/, '')
    if (fence) {
      // 閉じるフェンスは開いたものと同じ記号で、長さが同じか長いもの
      const closing = CLOSING_FENCE_PATTERN.exec(text)
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    const fenceMatch = FENCE_PATTERN.exec(text)
    if (fenceMatch) {
      fence = fenceMatch[1]
      continue
    }
    const heading = HEADING_PATTERN.exec(text)
    if (heading) {
      headings.push({ level: heading[1].length, text: stripClosingSequence(heading[2] ?? ''), line })
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

/** 出現数。重なる出現も数える(`aaa` の中の `aa` は2回) */
const countOccurrences = (text: string, search: string): number => {
  let count = 0
  for (let at = text.indexOf(search); at >= 0; at = text.indexOf(search, at + 1)) {
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
