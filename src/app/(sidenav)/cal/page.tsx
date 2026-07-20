import { envu } from '@/lib/env-util'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CalClient } from './client'

export const metadata: Metadata = {
  title: 'Calendar',
}

const CalPage: FC = async () => {
  // 共有URLのベースはアプリの公開URL(BETTER_AUTH_URL)を利用する
  return <CalClient origin={envu.server.BETTER_AUTH_URL} />
}
export default CalPage
