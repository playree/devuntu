import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CommandTargetClient } from './client'

export const metadata: Metadata = {
  title: en.command_target_settings,
}

/**
 * ターゲット設定ページ
 */
const CommandTargetPage: FC<{ params: Promise<{ targetId: string }> }> = async ({ params }) => {
  const { targetId } = await params
  return <CommandTargetClient targetKey={targetId} />
}
export default CommandTargetPage
