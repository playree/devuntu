import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardDetailClient } from './client'

export const metadata: Metadata = {
  title: en.board,
}

const BoardDetailPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <BoardDetailClient boardId={id} />
}
export default BoardDetailPage
