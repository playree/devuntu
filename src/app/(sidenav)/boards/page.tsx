import { getServerSession } from '@/lib/auth/auth'
import { ensurePrivateBoard } from '@/lib/board/board'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardsClient } from './client'

export const metadata: Metadata = {
  title: en.board,
}

const BoardsPage: FC = async () => {
  // プライベートチケットもボード経由で可視化するため、一覧の取得(読み取りのみ)より先にここで用意する
  const session = await getServerSession()
  if (session) {
    await ensurePrivateBoard(session.user)
  }

  return <BoardsClient />
}
export default BoardsPage
