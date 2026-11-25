import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpaceSettingsClient } from './client'

export const metadata: Metadata = {
  title: en.wiki_space_settings,
}

const WikiSpaceSettingsPage: FC = () => <WikiSpaceSettingsClient />
export default WikiSpaceSettingsPage
