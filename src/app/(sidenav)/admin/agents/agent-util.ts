/**
 * エージェント管理画面のサーバー側で共有する検証。
 *
 * `server.ts` / `runner-server.ts` は 'use server' なので、export したものはすべて
 * Server Action(= 外から叩ける口)になる。共有したい非公開の関数はこちらへ置く。
 */

import { errInvalidOperation } from '@/lib/error'
import { prisma } from '@/lib/prisma'

/** 操作対象がエージェントであることを確かめる。人間のユーザーはこの画面から触れない */
export const assertAgent = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id }, select: { isAgent: true } })
  if (!user?.isAgent) {
    throw errInvalidOperation()
  }
}
