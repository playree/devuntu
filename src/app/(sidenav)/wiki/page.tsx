import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpacesClient } from './client'

export const metadata: Metadata = {
  title: en.wiki,
}

const WikiSpacesPage: FC = () => <WikiSpacesClient />
export default WikiSpacesPage
