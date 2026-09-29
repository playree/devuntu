/**
 * コマンド定義の検証メッセージ(クライアント / サーバー共用)
 *
 * 検証はリクエスト外(定義ディレクトリの読み込み)でも走り、表示するロケールを知らない。
 * そのため検証側はロケールキーと差し込む値だけを返し、文字列にするのは表示側に任せる。
 *
 * zod の既定文や YAML パーサー・ファイル操作のエラーのように訳を持たない文言は `text` にそのまま入れる。
 */

import { type LocaleValues } from '@/lib/locale-util'
import { type LocaleItem } from '@/locale'

export type CommandMessage = ({ item: LocaleItem; values?: LocaleValues } | { text: string }) & {
  /** 指摘の位置(`commands.0.id` など)。無ければ全体への指摘 */
  path?: string
}

export type CommandMessageTranslator = (item: LocaleItem, values?: LocaleValues) => string

export const commandMessage = (item: LocaleItem, values?: LocaleValues): CommandMessage =>
  values ? { item, values } : { item }

export const commandText = (text: string): CommandMessage => ({ text })

/** 例外の文言。`Error` 以外が投げられた場合も文字列にする */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const formatCommandMessage = (message: CommandMessage, t: CommandMessageTranslator): string => {
  const body = 'item' in message ? t(message.item, message.values) : message.text
  return message.path ? `${message.path}: ${body}` : body
}
