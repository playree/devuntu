/** setup-env の表示メッセージ。言語の決め方は `../i18n.mjs` を参照 */
import { createT } from '../i18n.mjs'
import { en } from './lang-en.mjs'
import { ja } from './lang-ja.mjs'

export const messages = { ja, en }

export const t = createT(messages)
