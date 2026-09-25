/**
 * メンション記法の抽出・解決と入力補助
 *
 * サーバー / クライアントの双方から import する純粋関数のみを置く。
 */

/** メンションに書けるメールアドレスの最大長(RFC 5321 の上限) */
export const MENTION_EMAIL_MAX = 254

/** 候補として一度に出す最大件数 */
export const MENTION_CANDIDATE_LIMIT = 8

/**
 * メンション記法 `@[foo@example.com]`
 *
 * 角括弧の中はメールアドレスに見える形(`@` と `.` を含み、空白と角括弧を含まない)だけを受け付ける。
 * 直前が単語文字 / `@` の場合はメールアドレスの一部を拾ったものとみなして無視する。
 *
 * `@\[...]` も拾うのは、エディタを通さず素のテキストとして書かれた場合の保険。
 * Markdown の書き出しでは `[` がエスケープされるため、その形が本文へ入りうる
 * (エディタから挿入したメンションは {@link formatMentionSource} が直接書き出すのでエスケープされない)。
 */
const RE_MENTION = /(?<![\w@])@\\?\[([^\s[\]@]+@[^\s[\]@]+\.[^\s[\]@]+)]/g

/**
 * Markdown のコードブロック / インラインコードを除去する(メンションの対象外にする)
 *
 * 開始と終了のバッククォート数を後方参照で揃えるため、``` ``@[foo@example.com]`` `` のように
 * バッククォートを重ねた記法でも中身を取りこぼさない。フェンスを先に落とすのは、
 * インラインの規則(改行を含まない)ではフェンス内の複数行を扱えないため。
 * 4 スペースインデントのコードブロックはリストの継続行と区別できないので対象外とする。
 */
export const stripCodeSpans = (markdown: string): string =>
  markdown.replace(/(```+|~~~+)[\s\S]*?\1/g, ' ').replace(/(`+)[^\n]*?\1/g, ' ')

/** メンションの突き合わせ用の正規化(全角/半角・大文字小文字の差異を吸収する) */
export const normalizeMentionText = (text: string): string => text.normalize('NFKC').trim().toLowerCase()

/** 本文中で見つけたメンション。表示用のノードへ差し替えるために位置も返す */
export type MentionMatch = {
  /** 正規化済みのメールアドレス */
  email: string
  /** `@` の位置 */
  index: number
  /** 記法全体の長さ */
  length: number
}

/** テキストからメンション記法を出現順に拾う。抽出と表示用ノードへの差し替えで共有する */
export const findMentions = (text: string): MentionMatch[] => {
  const matches: MentionMatch[] = []

  for (const match of text.matchAll(RE_MENTION)) {
    const email = normalizeMentionText(match[1])
    if (email.length > MENTION_EMAIL_MAX) {
      continue
    }
    matches.push({ email, index: match.index, length: match[0].length })
  }

  return matches
}

/** 本文からメンション対象のメールアドレスを出現順・重複なしで抽出する */
export const extractMentionEmails = (content: string): string[] => [
  ...new Set(findMentions(stripCodeSpans(content)).map(({ email }) => email)),
]

/**
 * メールアドレスを userId へ解決する。
 * candidates には「そのチケットにアクセスできるユーザー」のみを渡すこと。
 */
export const resolveMentionUserIds = (emails: string[], candidates: { id: string; email: string }[]): string[] => {
  const idByEmail = new Map(candidates.map(({ id, email }) => [normalizeMentionText(email), id]))

  const resolved: string[] = []
  const seen = new Set<string>()
  for (const email of emails) {
    const id = idByEmail.get(normalizeMentionText(email))
    if (id && !seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }

  return resolved
}

/* -------------------------------------------------------------------------------------------------
 * メンションの入力補助
 * -----------------------------------------------------------------------------------------------*/

/**
 * キャレット直前の `@クエリ` を捉える。{@link RE_MENTION} と同じ前置ルール
 * (直前が単語文字 / `@` でない)にすることで、本文中のメールアドレスでは発火しないようにする。
 * クエリ 0 文字( `@` を打った直後)でも一致させて、その時点で一覧を出せるようにする。
 *
 * クエリに使えない文字は空白と角括弧だけ。選択結果は記法ではなくノードとして挿入されるため、
 * クエリがそのまま本文へ残ることはなく、`.` や `@` を含むメールアドレスでも絞り込める。
 */
const RE_MENTION_TRIGGER = new RegExp(`(^|[^\\w@])(@(?!@)([^\\s[\\]]{0,${MENTION_EMAIL_MAX}}))$`)

/** メンション候補の最小形。`{@link filterMentionCandidates}` は余分な項目を保ったまま絞り込む */
export type MentionCandidateLike = {
  name: string
  email: string
}

/** 入力補助が見つけたメンション。Lexical の typeahead が要求する形に合わせている */
export type MentionTriggerMatch = {
  /** `@` の位置(渡したテキストの先頭からのオフセット) */
  leadOffset: number
  /** `@` に続くクエリ */
  matchingString: string
  /** 候補を選んだときに置き換える範囲(`@` を含む) */
  replaceableString: string
}

/** キャレットまでのテキストから入力中のメンションを取り出す。無ければ null */
export const matchMentionTrigger = (textBeforeCaret: string): MentionTriggerMatch | null => {
  const match = RE_MENTION_TRIGGER.exec(textBeforeCaret)
  if (!match) {
    return null
  }
  return {
    leadOffset: match.index + match[1].length,
    matchingString: match[3],
    replaceableString: match[2],
  }
}

/** メンションを本文へ書き出す形にする。Markdown のエスケープを通さずそのまま出す前提 */
export const formatMentionSource = (email: string): string => `@[${normalizeMentionText(email)}]`

/**
 * 入力中のクエリで候補を絞り込む。担当者の ComboBox と同じ部分一致にしつつ、
 * 名前の前方一致・メールアドレスの前方一致・部分一致の順に寄せる。
 * クエリが空(`@` の直後)なら先頭から `limit` 件。
 */
export const filterMentionCandidates = <T extends MentionCandidateLike>(
  candidates: T[],
  query: string,
  limit: number = MENTION_CANDIDATE_LIMIT,
): T[] => {
  const key = normalizeMentionText(query)
  const nameMatched: T[] = []
  const emailMatched: T[] = []
  const partialMatched: T[] = []

  for (const candidate of candidates) {
    const name = normalizeMentionText(candidate.name)
    const email = normalizeMentionText(candidate.email)
    if (!key || name.startsWith(key)) {
      nameMatched.push(candidate)
    } else if (email.startsWith(key)) {
      emailMatched.push(candidate)
    } else if (name.includes(key) || email.includes(key)) {
      partialMatched.push(candidate)
    }
  }

  return [...nameMatched, ...emailMatched, ...partialMatched].slice(0, limit)
}
