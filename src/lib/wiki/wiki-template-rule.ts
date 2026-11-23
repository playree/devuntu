/**
 * Wiki のページテンプレートの定数と純粋関数
 *
 * サーバー / クライアントの双方から import する。DB アクセスは `wiki-template.ts` を参照。
 */

import { toZone } from '../day'

/** 1 スペースあたりのテンプレート数の上限(作成モーダルの選択肢が破綻しない範囲。チケットテンプレートと同じ) */
export const MAX_WIKI_TEMPLATES_PER_SPACE = 20

/** 種類 page のテンプレートが残っているスペースを設計書スペースにしようとした */
export const WIKI_SPACE_HAS_NORMAL_TEMPLATES = 'WIKI_SPACE_HAS_NORMAL_TEMPLATES'
/** プレースホルダーを置き換えたら、タイトルか本文が最大長を超えた */
export const WIKI_TEMPLATE_TOO_LONG = 'WIKI_TEMPLATE_TOO_LONG'

/** 作成時に置き換える値 */
export type WikiTemplateContext = {
  now: Date
  /** 日付を決めるタイムゾーン(作成者の設定) */
  timezone: string
  /** 作成者の表示名 */
  userName: string
}

const PLACEHOLDER_PATTERN = /\{\{(date|month|user)\}\}/g

/**
 * `{{date}}`(YYYY-MM-DD)/ `{{month}}`(YYYY-MM)/ `{{user}}`(作成者の表示名)を置き換える。
 * 1 回の走査で置き換えるので、表示名に `{{date}}` などが含まれていても置き換え直さない。知らない `{{...}}` は残す
 */
export const applyWikiTemplatePlaceholders = (
  text: string,
  { now, timezone, userName }: WikiTemplateContext,
): string => {
  const zoned = toZone(now, timezone)
  const values: Record<string, string> = {
    date: zoned.format('YYYY-MM-DD'),
    month: zoned.format('YYYY-MM'),
    user: userName,
  }
  return text.replace(PLACEHOLDER_PATTERN, (_, name: string) => values[name])
}
