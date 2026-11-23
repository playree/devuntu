import { parseWikiAnnouncementParams } from '@/lib/wiki/wiki-announcement-rule'
import { en } from '@/locale/lang-en'
import { type Metadata } from 'next'
import { FC } from 'react'
import { WikiSpaceTopClient } from './client'

export const metadata: Metadata = {
  title: en.wiki,
}

/** スペースのトップ。アナウンス用スペースの絞り込み(`month` / `year` / `tag`)は URL に持ち、共有や戻る・進むで再現できるようにする */
const WikiSpaceTopPage: FC<{
  searchParams: Promise<{ month?: string | string[]; year?: string | string[]; tag?: string | string[] }>
}> = async ({ searchParams }) => (
  <WikiSpaceTopClient announcementFilter={parseWikiAnnouncementParams(await searchParams)} />
)
export default WikiSpaceTopPage
