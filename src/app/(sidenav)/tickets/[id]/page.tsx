import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { TicketDetailClient } from './client'

export const metadata: Metadata = { title: en.ticket }

/**
 * チケット詳細。データ取得は既存規約に合わせクライアント側の Server Action で行う
 * (認可も Action 側で検証するため、ここでは id の受け渡しのみ)。
 */
const TicketDetailPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <TicketDetailClient id={id} />
}
export default TicketDetailPage
