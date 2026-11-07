/** GitHub 形式の注意書き(`> [!NOTE]`)の種類。並びは GitHub のドキュメントに合わせる */
export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type AlertType = (typeof ALERT_TYPES)[number]

const ALERT_MARKER_RE = new RegExp(`^\\[!(${ALERT_TYPES.join('|')})\\][ \\t]*(?:\\n|$)`, 'i')

/**
 * 引用の先頭のテキストから注意書きの目印を読み取る。
 * GitHub と同じく、目印は行の中で単独でなければならず(`[!NOTE] 本文` は対象外)、大文字小文字は問わない。
 *
 * @returns 種類と目印の後ろのテキスト。目印で始まらなければ undefined
 */
export const parseAlertMarker = (text: string): { type: AlertType; rest: string } | undefined => {
  const m = ALERT_MARKER_RE.exec(text)
  if (!m) {
    return undefined
  }
  return { type: m[1].toLowerCase() as AlertType, rest: text.slice(m[0].length) }
}

const ESCAPED_MARKER_RE = new RegExp(`^> \\\\\\[!(${ALERT_TYPES.join('|')})\\](?=[ \\t]*(?:\\n|$))`, 'i')

/**
 * 書き出した引用の先頭にある、エスケープされた注意書きの目印(`> \[!NOTE]`)を元に戻す。
 *
 * mdast-util-to-markdown はテキスト中の `[` をエスケープするため、そのまま保存すると記法が崩れる。
 * 戻すのは引用の先頭だけで、本文中に書いた `\[!NOTE]` には触れない。
 */
export const unescapeAlertMarker = (blockquote: string): string => blockquote.replace(ESCAPED_MARKER_RE, '> [!$1]')
