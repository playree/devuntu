import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CommandsClient } from './client'

export const metadata: Metadata = {
  title: en.command_exec,
}

/**
 * リモート実行ページ
 */
const CommandsPage: FC = async () => {
  return <CommandsClient />
}
export default CommandsPage
