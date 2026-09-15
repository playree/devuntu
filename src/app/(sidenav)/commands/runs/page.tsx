import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CommandRunsClient } from './client'

export const metadata: Metadata = {
  title: en.command_run_history,
}

/**
 * コマンドの実行履歴
 */
const CommandRunsPage: FC = async () => {
  return <CommandRunsClient />
}
export default CommandRunsPage
