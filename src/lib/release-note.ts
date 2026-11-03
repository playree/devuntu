/**
 * リリースノート本文の要点と詳細の区切り。GitHub 上では表示されない HTML コメントにしている
 */
export const RELEASE_NOTE_DETAILS_MARKER = '<!-- details -->'

/**
 * 要点の日本語と英語の区切り。区切りより前が日本語、以降が英語の要点
 */
export const RELEASE_NOTE_EN_MARKER = /<!--\s*lang:en\s*-->/

/**
 * リリースノート本文を要点だけにする。区切りより前が要点で、区切りが無ければ(この形式より前のリリース)全文を要点とする。
 * 要点は英語の区切りで日本語(`summary`)と英語(`summaryEn`)に分ける。英語が無ければ `summaryEn` は空
 */
export const splitReleaseNote = (body: string | null | undefined) => {
  const text = body ?? ''
  const index = text.indexOf(RELEASE_NOTE_DETAILS_MARKER)
  const hasDetails = index >= 0
  const [summary, summaryEn = ''] = (hasDetails ? text.slice(0, index) : text).split(RELEASE_NOTE_EN_MARKER, 2)
  return { summary: summary.trim(), summaryEn: summaryEn.trim(), hasDetails }
}

/**
 * 表示する要点を選ぶ。日本語なら日本語、それ以外は英語(英語が無いリリースは日本語)
 */
export const pickReleaseNoteSummary = (note: { summary: string; summaryEn: string }, locale: string) => {
  if (locale === 'ja') {
    return note.summary
  }
  return note.summaryEn || note.summary
}
