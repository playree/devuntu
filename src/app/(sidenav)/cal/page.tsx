import { getServerSession } from '@/lib/auth/auth'
import { canUseGoogleAccount } from '@/lib/google/google-account'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { CalClient } from './client'
import { CalUnavailable } from './unavailable'

export const metadata: Metadata = {
  title: en.calendar,
}

const CalPage: FC = async () => {
  const session = await getServerSession()
  const googleAvailable = session ? await canUseGoogleAccount(session.user.id) : false
  if (!googleAvailable) {
    // Google連携が無効なら共有カレンダー機能も利用不可
    return <CalUnavailable />
  }

  return <CalClient />
}
export default CalPage
