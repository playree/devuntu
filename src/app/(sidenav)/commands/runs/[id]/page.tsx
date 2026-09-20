import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CommandRunClient } from './client'

export const metadata: Metadata = {
  title: en.command_run_detail,
}

/**
 * 実行の詳細。
 *
 * 実行中の表示と履歴の閲覧を同じ画面にしてある。途中から見る / リロード / 別タブ /
 * URL の共有がすべて同じ経路で成立し、UI を分岐させずに済む。
 */
const CommandRunPage: FC<{ params: Promise<{ id: string }> }> = async ({ params }) => {
  const { id } = await params
  return <CommandRunClient runId={id} />
}
export default CommandRunPage
