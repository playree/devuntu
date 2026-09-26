/**
 * どこからも参照されていない添付の掃除(サーバー専用)
 *
 * 添付は本文の保存より先に作られ、本文から外れても消えない。ボード削除・チケット削除・
 * 本文の編集・アップロードしたまま保存しなかった場合のいずれでも取り残される。
 * 参照は外部キーではなく本文中のURLなので、参照の有無は文字列で判断するしかない。
 *
 * 掃除全体の中で唯一の不可逆操作なので、次の3段構えで守る。
 *
 * 1. 猶予 : 作成から `MAINTENANCE_ATTACHMENT_GRACE_HOURS` 経つまで対象にしない
 * 2. 二重の確認 : 集合で絞ってから、消す直前にもう一度その1件だけを引き直す
 * 3. 上限 : 1周で消す件数を頭打ちにする
 */

import { HOUR_MS, msBefore } from '@/lib/day'
import { envu } from '../env-util'
import { logger } from '../logger'
import { prisma } from '../prisma'
import { removeAttachmentByKey } from '../storage/attachment'
import { collectReferencedUploadKeys, findAttachmentReference } from '../storage/attachment-ref'
import { ATTACHMENT_DELETE_MAX, ATTACHMENT_SCAN_BATCH, ATTACHMENT_SWEEP_INTERVAL_MS } from './maintenance'

/** 本文の全走査を伴うので、tick ごとではなくこの間隔で回す。走り切った周の時刻だけを記録する */
let lastSweptAt: Date | null = null

/** テスト用に間隔の記録を戻す */
export const resetAttachmentSweepThrottle = (): void => {
  lastSweptAt = null
}

export const sweepOrphanAttachments = async (now: Date): Promise<number> => {
  const mode = envu.server.MAINTENANCE_ATTACHMENT_MODE
  if (mode === 'off') {
    return 0
  }
  if (lastSweptAt && now.getTime() - lastSweptAt.getTime() < ATTACHMENT_SWEEP_INTERVAL_MS) {
    return 0
  }

  const cutoff = msBefore(now, envu.server.MAINTENANCE_ATTACHMENT_GRACE_HOURS * HOUR_MS)
  const referenced = await collectReferencedUploadKeys()

  let deleted = 0
  let cursor: string | undefined
  let capped = false

  while (!capped) {
    // ページ送りは主キー(uuidv7 = 作成順)のカーソル。使用中の添付が並んでも先へ進む
    const page = await prisma.attachment.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, key: true, size: true },
      orderBy: { id: 'asc' },
      take: ATTACHMENT_SCAN_BATCH,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    })

    for (const row of page) {
      if (referenced.has(row.key)) {
        continue
      }
      // 集合を作ってから今までの間に貼られた本文を取りこぼさないよう、消す直前に引き直す
      if (await findAttachmentReference(row.key)) {
        continue
      }

      if (mode === 'dry-run') {
        logger.info({ key: row.key, size: row.size }, 'orphan attachment (dry-run)')
      } else if (await removeAttachmentByKey(row.key)) {
        deleted += 1
      }

      if (deleted >= ATTACHMENT_DELETE_MAX) {
        logger.warn({ deleted }, 'orphan attachment sweep capped')
        capped = true
        break
      }
    }

    if (page.length < ATTACHMENT_SCAN_BATCH) {
      break
    }
    cursor = page[page.length - 1].id
  }

  // 記録は最後まで走り切ってから。途中で落ちた周は次の tick でやり直す
  lastSweptAt = now

  logger.info({ deleted, mode }, 'orphan attachment sweep finished')
  return deleted
}
