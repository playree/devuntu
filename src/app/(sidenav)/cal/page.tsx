import { getServerSession } from '@/lib/auth'
import { envu } from '@/lib/env-util'
import { canUseGoogleAccount } from '@/lib/google/google-account'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CalClient } from './client'
import { CalUnavailable } from './unavailable'

export const metadata: Metadata = {
  title: 'Calendar',
}

const CalPage: FC = async () => {
  const session = await getServerSession()
  const googleAvailable = session ? await canUseGoogleAccount(session.user.id) : false
  if (!googleAvailable) {
    // Google連携が無効なら共有カレンダー機能も利用不可
    return <CalUnavailable />
  }

  // 共有URLのベースはアプリの公開URL(BETTER_AUTH_URL)を利用する
  return <CalClient origin={envu.server.BETTER_AUTH_URL} />
}
export default CalPage
