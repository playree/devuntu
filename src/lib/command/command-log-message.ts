/**
 * 実行ログのシステム行をロケール非依存で保存するためのエンコード。
 *
 * システム行を書くのは実行中のワーカーで、リクエストのロケールを持たない。
 * そのため DB にはロケールキーと差し込む値だけを入れておき、表示側で解決する。
 *
 * この仕組みより前に保存された行は平文のまま残っている。`decodeSystemMessage` は
 * それを null で返し、呼び出し元がそのまま表示できるようにする。
 */

import { type LocaleValues } from '@/lib/locale-util'
import { type LocaleItem } from '@/locale'

/**
 * 平文と区別するための目印。
 *
 * `sanitizeLogText` が落とすのは NUL と孤立サロゲートだけなので `\u0001` は保存後も残る。
 */
const MARKER = '\u0001lc:'

export type SystemMessage = { item: LocaleItem; values?: LocaleValues }

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
  if (typeof item !== 'string') {
    return null
  }
  if (values === undefined) {
    return { item: item as LocaleItem }
  }
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return null
  }
  return { item: item as LocaleItem, values: values as LocaleValues }
}
