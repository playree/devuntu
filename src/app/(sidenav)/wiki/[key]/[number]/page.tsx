import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiPageClient } from './client'

export const metadata: Metadata = {
  title: en.wiki,
}

const WikiPagePage: FC<{ params: Promise<{ key: string; number: string }> }> = async ({ params }) => {
  const { key, number } = await params
  return <WikiPageClient spaceKey={key.toUpperCase()} number={Number(number)} />
}
export default WikiPagePage
