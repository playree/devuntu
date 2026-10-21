import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardNotesClient } from './client'

export const metadata: Metadata = {
  title: en.board_notes,
}

const BoardNotesPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <BoardNotesClient boardId={id} />
}
export default BoardNotesPage
