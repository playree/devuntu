/**
 * Markdown 中の生HTMLで通してよいタグ。
 *
 * MDXEditor は生HTMLを `document.createElement(tag)` + 属性そのままの `setAttribute` で
 * DOM 化する(許可タグ一覧に `script` / `style` / `iframe` を含み、属性の検査も無い)。
 * そのため表示・編集の両方で `mdx-sanitize-plugin` を通し、ここに無いタグは
 * タグごと落として中身のテキストだけを残す。属性は許可タグでも全て捨てるので、
 * 属性なしで意味が完結するものだけを並べる。
 *
 * `u` / `sup` / `sub` はインラインなら MDXEditor 本体の formatting visitor が先に
 * 処理するが、フロー要素として現れた場合に落とさないようここにも入れる。
 */
export const ALLOWED_HTML_TAGS: ReadonlySet<string> = new Set([
  'br',
  'u',
  's',
  'del',
  'ins',
  'mark',
  'kbd',
  'sub',
  'sup',
])

export const isAllowedHtmlTag = (name: string | null | undefined): name is string =>
  !!name && ALLOWED_HTML_TAGS.has(name)

/**
 * タグだけでなく中身も捨てるタグ。
 *
 * 許可外のタグは中身のテキストを残すが、これらの中身は本文ではないので
 * 残すと `body{display:none}` のようなコードが本文として見えてしまう。
 */
const DROPPED_HTML_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template', 'title', 'textarea'])

export const isDroppedHtmlTag = (name: string | null | undefined) => !!name && DROPPED_HTML_TAGS.has(name)

/** リンクとして開いてよいスキーム。Lexical の `LinkNode` が `sanitizeUrl` で許可しているものに揃える */
const SAFE_LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'sms:', 'tel:'])

/**
 * リンク先の URL を無害化する。許可外のスキーム(`javascript:` / `data:` など)は `about:blank` にする。
 *
 * `LinkNode` を使わず独自ノードで `<a>` を描画するときに、標準のリンクと同じ判定を通すためのもの。
 * スキームを持たない相対 URL はそのまま通す。
 */
export const sanitizeLinkUrl = (url: string): string => {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return url
  }
  return SAFE_LINK_PROTOCOLS.has(protocol) ? url : 'about:blank'
}
