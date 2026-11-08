import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpaceSearchClient } from './client'

export const metadata: Metadata = {
  title: en.wiki_search,
}

/** スペース内の検索。条件(`q` / `tags`)は URL に持ち、共有や戻る・進むで再現できるようにする */
const WikiSpaceSearchPage: FC<{ searchParams: Promise<{ q?: string | string[]; tags?: string | string[] }> }> = async ({
  searchParams,
}) => {
  const { q, tags } = await searchParams
  return <WikiSpaceSearchClient keyword={[q ?? []].flat()[0]?.trim() ?? ''} tags={[tags ?? []].flat()} />
}
export default WikiSpaceSearchPage
