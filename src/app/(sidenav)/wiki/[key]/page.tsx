import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpaceTopClient } from './client'

export const metadata: Metadata = {
  title: en.wiki,
}

const WikiSpaceTopPage: FC = () => <WikiSpaceTopClient />
export default WikiSpaceTopPage
