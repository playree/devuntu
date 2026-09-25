/**
 * ボードキーの占有と採番(サーバー専用)
 */

import { Prisma } from '@/generated/prisma/client'
import { errClient, errInvalidOperation } from '../error'
import { isUniqueViolation } from '../prisma'
import { DUPLICATED_BOARD_KEY, nextSequentialKey, PRIVATE_BOARD_KEY_PREFIX } from './ticket-id'

/** キー重複の一意制約違反を DUPLICATED_BOARD_KEY へ変換して再 throw する */
export const rethrowDuplicatedBoardKey = (e: unknown): never => {
  if (isUniqueViolation(e)) {
    throw errClient(DUPLICATED_BOARD_KEY)
  }
  throw e
}

/**
 * ボードキーを履歴(BoardKeyHistory)へ登録して占有する。他ボードが使ったことのあるキーなら
 * DUPLICATED_BOARD_KEY。
 *
 * `Board.key` の @unique だけでは「改名 / 削除で手放したキーを別ボードが取る」ことを防げず、
 * 共有済みの表示ID(`KEY-番号`)が別ボードの同番号チケットへ解決されてしまう。
 * 履歴の行はボードを消しても残すので、一度使ったキーが別のボードへ渡ることはない。
 *
 * 自分が以前使っていたキーへ戻す場合だけは許す(表示IDの指す先が変わらないため)。
 * `boardId` 未指定は新規作成 = まだ手放したキーを持たないので、履歴があれば必ず拒否になる。
 *
 * ボードの作成 / キー変更と同じトランザクションで呼ぶこと(失敗時にキーを焼かないため)。
 */
export const reserveBoardKey = async (tx: Prisma.TransactionClient, key: string, boardId?: string): Promise<void> => {
  const used = await tx.boardKeyHistory.findUnique({ where: { key }, select: { boardId: true } })
  if (used) {
    if (!boardId || used.boardId !== boardId) {
      throw errClient(DUPLICATED_BOARD_KEY)
    }
    return
  }

  await tx.boardKeyHistory.create({ data: { key, boardId }, select: { key: true } }).catch(rethrowDuplicatedBoardKey)
}

/**
 * プライベートボードのキー(PRV<連番>)。既存の最大 + 1 を採る。
 * 桁が MAX_BOARD_KEY を超えると表示IDを解決できないボードになるため、その手前で失敗させる。
 *
 * 採番の母集団は現存ボードではなく履歴(BoardKeyHistory)。退会などでプライベートボードが
 * 消えても、その番号を別ユーザーへ再発行しない(共有済みの表示IDが別人のチケットを指さない)。
 * PRV 接頭辞はチームボードのキー入力から `isReservedBoardKey` で除外してあるため、
 * ここの母集団に利用者が作ったキーが混ざることはない。
 */
export const nextPrivateBoardKey = async (tx: Prisma.TransactionClient): Promise<string> => {
  const used = await tx.boardKeyHistory.findMany({
    where: { key: { startsWith: PRIVATE_BOARD_KEY_PREFIX } },
    select: { key: true },
  })
  const key = nextSequentialKey(
    PRIVATE_BOARD_KEY_PREFIX,
    used.map(({ key }) => key),
  )
  if (!key) {
    throw errInvalidOperation()
  }
  return key
}
