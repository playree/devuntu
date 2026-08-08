import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardKanbanClient } from './client'

export const metadata: Metadata = {
  title: en.board,
}

const BoardKanbanPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <BoardKanbanClient boardId={id} />
}
export default BoardKanbanPage
