import { en } from '@/locale/lang-en'
import { Metadata } from 'next'
import { FC } from 'react'
import { TicketsClient } from './client'

export const metadata: Metadata = { title: en.ticket }

const TicketsPage: FC = async () => <TicketsClient />
export default TicketsPage
