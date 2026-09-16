import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AdminCommandTargetClient } from './client'

export const metadata: Metadata = {
  title: en.command_target_assign,
}

/**
 * ターゲットのアサイン編集ページ
 */
const AdminCommandTargetPage: FC<{ params: Promise<{ targetId: string }> }> = async ({ params }) => {
  const { targetId } = await params
  return <AdminCommandTargetClient targetKey={targetId} />
}
export default AdminCommandTargetPage
