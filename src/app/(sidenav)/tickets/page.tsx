import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { TicketsClient } from './client'

export const metadata: Metadata = { title: en.ticket }

const TicketsPage: FC = () => <TicketsClient />
export default TicketsPage
