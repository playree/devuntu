/**
 * コマンド定義の検証メッセージを、画面と同じ手順で文字列へ解決する
 */

import { type CommandMessage, formatCommandMessage } from '@/lib/command/command-message'
import { expandTemplate } from '@/lib/locale-util'
import { en } from '@/locale/lang-en'
import { ja } from '@/locale/lang-ja'

export const formatJa = (message: CommandMessage): string =>
  formatCommandMessage(message, (item, values) => expandTemplate(ja[item], values))

export const formatEn = (message: CommandMessage): string =>
  formatCommandMessage(message, (item, values) => expandTemplate(en[item], values))
