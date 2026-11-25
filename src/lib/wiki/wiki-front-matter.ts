/**
 * Wiki ページ本文の front matter(先頭の YAML)の純粋関数
 *
 * 設計書(Markdown Design Doc Viewer の `type: design_doc`)の判定と、最小の front matter の生成に使う。
 */

const FRONT_MATTER_OPEN = /^---[ \t]*$/
const FRONT_MATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/
/**
 * 最上位の `type: design_doc`(キーと値の引用符の有無、行末コメントは問わない)。
 * ビューアの判定に合わせ、コロンの後には空白を要する(`type:design_doc` は YAML でもキーにならない)
 */
const DESIGN_DOC_TYPE = /^(["']?)type\1[ \t]*:[ \t]+(["']?)design_doc\2[ \t]*(?:#.*)?$/

/** 先頭の front matter(YAML)の行。閉じていなければ front matter とみなさず null。BOM と CRLF は無視する */
export const frontMatterLines = (content: string): string[] | null => {
  const lines = content.replace(/^\uFEFF/, '').split('\n')
  if (!FRONT_MATTER_OPEN.test(lines[0].replace(/\r$/, ''))) {
    return null
  }
  const body: string[] = []
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r$/, '')
    if (FRONT_MATTER_CLOSE.test(line)) {
      return body
    }
    body.push(line)
  }
  return null
}

/** 先頭の front matter を区切り線ごと取り出す(改行は LF にそろえる)。無ければ null */
export const frontMatterBlock = (content: string): string | null => {
  const lines = frontMatterLines(content)
  return lines && ['---', ...lines, '---', ''].join('\n')
}

/** 本文の1行目が front matter の開始の区切りか(閉じの区切りまでは見ない) */
export const startsWithFrontMatter = (content: string): boolean =>
  FRONT_MATTER_OPEN.test(
    content
      .replace(/^\uFEFF/, '')
      .split('\n', 1)[0]
      .replace(/\r$/, ''),
  )

/** 本文が front matter を持つか */
export const hasFrontMatter = (content: string): boolean => frontMatterLines(content) !== null

/** 本文の front matter が `type: design_doc`(Markdown Design Doc Viewer の設計書)か。MCP で種類を省略したときの推定に使う */
export const hasDesignDocFrontMatter = (content: string): boolean =>
  frontMatterLines(content)?.some((line) => DESIGN_DOC_TYPE.test(line)) ?? false

/**
 * front matter のタイトルの値。ビューアは引用符を外すだけでエスケープを戻さないので、
 * エスケープが要らなければダブルクオート、要るならブロックスカラーにする(どちらも YAML として同じ値になる)
 */
const frontMatterTitle = (title: string): string => {
  const quoted = JSON.stringify(title)
  return quoted === `"${title}"` ? quoted : `|-\n  ${title}`
}

/** 設計書の最小の front matter(本文の先頭に置く) */
export const designDocFrontMatter = (title: string): string =>
  `---\ntype: design_doc\ntitle: ${frontMatterTitle(title.trim())}\n---\n\n`
