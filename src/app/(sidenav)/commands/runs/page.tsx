import { scCommandRunListQuery } from '@/lib/schema/schema-command'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CommandRunsClient } from './client'

export const metadata: Metadata = {
  title: en.command_run_history,
}

/**
 * コマンドの実行履歴
 *
 * `?commandKey=` が付いていればそのコマンドだけに絞って開く(リモート実行の各カードからの導線)。
 */
const CommandRunsPage: FC<{ searchParams: Promise<{ commandKey?: string }> }> = async ({ searchParams }) => {
  const { commandKey } = await searchParams
  // 不正な値をそのまま Server Action に渡すとバリデーションエラーになるので、ここで弾いて全件表示に落とす
  const initialCommandKey = scCommandRunListQuery.shape.commandKey.safeParse(commandKey).data ?? null
  return <CommandRunsClient initialCommandKey={initialCommandKey} />
}
export default CommandRunsPage
