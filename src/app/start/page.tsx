import { type Metadata } from 'next'
import { FC } from 'react'
import { StartClient } from './client'

export const metadata: Metadata = {
  title: 'Start',
}

const StartPage: FC = async () => {
  return <StartClient />
}
export default StartPage
