import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardSettingsClient } from './client'

export const metadata: Metadata = {
  title: en.board_settings,
}

const BoardSettingsPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <BoardSettingsClient boardId={id} />
}
export default BoardSettingsPage
