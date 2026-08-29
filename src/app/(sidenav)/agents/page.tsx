import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { AgentsClient } from './client'

export const metadata: Metadata = { title: en.agent }

const AgentsPage: FC = () => <AgentsClient />
export default AgentsPage
