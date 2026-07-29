import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { BoardsClient } from './client'

export const metadata: Metadata = {
  title: en.board_manage,
}

const BoardsPage: FC = async () => {
  return <BoardsClient />
}
export default BoardsPage
