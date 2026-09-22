/**
 * 実行ログのシステム行をロケール非依存で保存するためのエンコード。
 *
 * システム行を書くのは実行中のワーカーで、リクエストのロケールを持たない。
 * そのため DB にはロケールキーと差し込む値だけを入れておき、表示側で解決する。
 *
 * この仕組みより前に保存された行は平文のまま残っている。`decodeSystemMessage` は
 * それを null で返し、呼び出し元がそのまま表示できるようにする。
 * 実在しないロケールキーや差し込めない値が入っていた行も同じく null で返す。
 * 解決できないまま `t()` に渡すと空文字列になり、元の行が消えてしまうため。
 */

import { type LocaleValues } from '@/lib/locale-util'
import { type LocaleItem } from '@/locale'
import { ja } from '@/locale/lang-ja'

/**
 * 平文と区別するための目印。
 *
 * `sanitizeLogText` が落とすのは NUL と孤立サロゲートだけなので `\u0001` は保存後も残る。
 */
const MARKER = '\u0001lc:'

export type SystemMessage = { item: LocaleItem; values?: LocaleValues }

/**
 * `LocaleItem` は型なので実行時には消える。全キーを持つ既定ロケールの辞書を実体として使う。
 * 継承プロパティ(`toString` など)をキーとして拾わないよう `Object.hasOwn` で見る。
 */
const isLocaleItem = (value: unknown): value is LocaleItem => typeof value === 'string' && Object.hasOwn(ja, value)

const isLocaleValues = (value: unknown): value is LocaleValues => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every(
    (item) => item === null || item === undefined || typeof item === 'string' || typeof item === 'number',
  )
}

export const encodeSystemMessage = (item: LocaleItem, values?: LocaleValues): string =>
  MARKER + JSON.stringify(values ? { item, values } : { item })

export const decodeSystemMessage = (text: string): SystemMessage | null => {
  if (!text.startsWith(MARKER)) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(MARKER.length))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const { item, values } = parsed as { item?: unknown; values?: unknown }
  if (!isLocaleItem(item)) {
    return null
  }
  if (values === undefined) {
    return { item }
  }
  if (!isLocaleValues(values)) {
    return null
  }
  return { item, values }
}
