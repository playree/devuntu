/**
 * リリースノート本文の要点と詳細の区切り。GitHub 上では表示されない HTML コメントにしている
 */
export const RELEASE_NOTE_DETAILS_MARKER = '<!-- details -->'

/**
 * 要点の言語の区切り(`<!-- lang:en -->` など)。次の区切りまでがそのロケールの要点
 */
export const RELEASE_NOTE_LANG_MARKER = /<!--\s*lang:([A-Za-z0-9-]+)\s*-->/

/**
 * リリースノート本文を要点だけにする。区切りより前が要点で、区切りが無ければ(この形式より前のリリース)全文を要点とする。
 * 要点は言語の区切りで分け、最初の区切りより前を既定の要点(`summary`)、区切り以降をロケールごとの要点(`localized`)とする
 */
export const splitReleaseNote = (body: string | null | undefined) => {
  const text = body ?? ''
  const index = text.indexOf(RELEASE_NOTE_DETAILS_MARKER)
  const hasDetails = index >= 0
  const [summary, ...rest] = (hasDetails ? text.slice(0, index) : text).split(RELEASE_NOTE_LANG_MARKER)
  const localized: Record<string, string> = {}
  for (let i = 0; i + 1 < rest.length; i += 2) {
    localized[rest[i]] = rest[i + 1].trim()
  }
  return { summary: summary.trim(), localized, hasDetails }
}
