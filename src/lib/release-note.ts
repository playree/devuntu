/**
 * リリースノート本文の要点と詳細の区切り。GitHub 上では表示されない HTML コメントにしている
 */
export const RELEASE_NOTE_DETAILS_MARKER = '<!-- details -->'

/**
 * リリースノート本文を要点だけにする。区切りより前が要点で、区切りが無ければ(この形式より前のリリース)全文を要点とする
 */
export const splitReleaseNote = (body: string | null | undefined) => {
  const text = body ?? ''
  const index = text.indexOf(RELEASE_NOTE_DETAILS_MARKER)
  if (index < 0) {
    return { summary: text.trim(), hasDetails: false }
  }
  return { summary: text.slice(0, index).trim(), hasDetails: true }
}
