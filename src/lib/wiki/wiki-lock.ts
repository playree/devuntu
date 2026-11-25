/**
 * Wiki のスペース行 / ページ行のロック(サーバー専用)
 *
 * トランザクション内で呼び、コミットまで保持する。wiki_space / wiki_page の行ロックはここの関数だけで取る。
 *
 * ロックの順序:
 * 1. スペース行。書き込みは必ず最初に取り、その後で権限(アーカイブを含む)を判定する
 *    - 構造(作成・移動・削除・復元)と設定(名前・割り当て・テンプレート・タグ・通知先・アーカイブ)を変える書き込みは
 *      `lockWikiSpace`(FOR NO KEY UPDATE)で直列にする。同時の移動で循環や深さ超過を作らない
 *    - 本文の更新・版の削除・アナウンスは `shareLockWikiSpace`(FOR SHARE)。互いには並行でき、上の書き込みとは直列になる
 *    - スペースの削除だけは `lockWikiSpaceForDelete`(FOR UPDATE)
 *    - どれも、版やページの INSERT が外部キーで取る FOR KEY SHARE とは衝突しない
 *    - ページの採番(`pageSeq` の UPDATE)もスペース行の排他ロックを取るが、構造のロックの後でしか行わない
 * 2. ページ行(`lockWikiPages`)。常にスペース行の後に取るので、「ページ行を持ったままスペース行を待つ」順序は生じない
 * 3. アナウンスの予約行(`wiki_announcement_notify` の FOR UPDATE SKIP LOCKED)。ワーカーもスペース行を先に取る
 *    (予約行を先に取ると、スペース行の後に予約行を待つページの削除とデッドロックする)
 */

import { Prisma } from '@/generated/prisma/client'
import type { Db } from '../prisma'

/** スペースの構造・設定を変える書き込みのロック */
export const lockWikiSpace = async (tx: Db, spaceId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`
}

/** 本文の更新・版の削除・アナウンスのロック。アーカイブや構造の変更とは直列になる */
export const shareLockWikiSpace = async (tx: Db, spaceId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR SHARE`
}

/** スペースの削除のロック */
export const lockWikiSpaceForDelete = async (tx: Db, spaceId: string): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_space" WHERE "id" = ${spaceId} FOR UPDATE`
}

/** ページ行のロック。スペース行のロックの後に取る */
export const lockWikiPages = async (tx: Db, pageIds: readonly string[]): Promise<void> => {
  await tx.$queryRaw`SELECT "id" FROM "wiki_page" WHERE "id" IN (${Prisma.join(pageIds)}) FOR NO KEY UPDATE`
}
