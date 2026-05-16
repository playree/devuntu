import { type Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'
import { StartClient } from './client'
import { hasCompletedInitialSetup } from './server'

export const metadata: Metadata = {
  title: 'Start',
}

const StartPage: FC = async () => {
  if (await hasCompletedInitialSetup()) {
    redirect('/')
    return <></>
  }

  return <StartClient />
}
export default StartPage
