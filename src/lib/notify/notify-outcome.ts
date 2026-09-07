/**
 * 配信結果の分類
 *
 * Slack の `SlackSendOutcome` をそのまま通知の共通語彙として使う。
 * 他のチャネルを足すときも同じ分類へ落とすことで、再試行の判断を1箇所に保てる。
 */

import type { SlackSendOutcome } from '../slack/slack'

export type DeliveryOutcome = SlackSendOutcome

/** 送信を諦めて行を消す結果。宛先が消えているだけなので通知の失敗としては扱わない */
export const isDeliverySettled = (outcome: DeliveryOutcome): boolean => outcome === 'ok' || outcome === 'unlinked'

/** そのチャネルの残りも全滅するので、この tick の送信を打ち切る結果 */
export const isDeliveryAborting = (outcome: DeliveryOutcome): boolean => outcome === 'revoked'
