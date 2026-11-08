import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpacesClient } from './client'

export const metadata: Metadata = {
  title: en.wiki,
}

/** `?q=` があればスペース一覧の代わりに横断検索の結果を出す */
const WikiSpacesPage: FC<{ searchParams: Promise<{ q?: string | string[] }> }> = async ({ searchParams }) => {
  const { q } = await searchParams
  return <WikiSpacesClient keyword={[q ?? []].flat()[0]?.trim() ?? ''} />
}
export default WikiSpacesPage
