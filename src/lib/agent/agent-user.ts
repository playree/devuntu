/**
 * 操作対象がエージェントか人間かの検証(サーバー専用)
 *
 * ユーザー管理とエージェント管理は同じ User テーブルを別の画面で扱うため、
 * それぞれの Server Action の先頭で相手側の行を触れないようにする。
 */

import { errInvalidOperation } from '../error'
import { prisma } from '../prisma'

/** 操作対象がエージェントであることを確かめる。人間のユーザーはエージェント管理から触れない */
export const assertAgent = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { isAgent: true } })
  if (!user?.isAgent) {
    throw errInvalidOperation()
  }
}

/** AIエージェントは /admin/agents で扱うので、ユーザー管理の操作対象から外す */
export const assertNotAgent = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { isAgent: true } })
  if (user?.isAgent) {
    throw errInvalidOperation()
  }
}
