/**
 * ボード / チケット行の `FOR UPDATE` ロック(サーバー専用)
 *
 * トランザクション内で呼び、コミットまで同じ行への他の書き込みを待たせる。
 * 何を直列にするか(数え上げ・採番・ロック順など)は呼び出し側に書く。
 */

import type { Prisma } from '@/generated/prisma/client'

/** ボード行のロック。ボード単位の数え上げ・採番・メンバー変更を直列にする */
export const lockBoardRow = async (tx: Prisma.TransactionClient, boardId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "board" WHERE "id" = ${boardId} FOR UPDATE`
}

/**
 * チケット行のロック。同じチケットへの同時更新を直列にする。
 * 変更前の値(変更履歴・通知の before)を読む場合はその前に取る。取らないと、先行の更新がコミットする前の値を読んで
 * 「A → C」のように実際と違う履歴を残しうる
 */
export const lockTicketRow = async (tx: Prisma.TransactionClient, ticketId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "ticket" WHERE "id" = ${ticketId} FOR UPDATE`
}
