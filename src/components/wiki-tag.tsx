'use client'

import type { TagColor } from '@/generated/prisma/enums'
import { wikiSearchHref } from '@/lib/wiki/wiki-rule'
import Link from 'next/link'
import { FC } from 'react'
import { TagChip } from './ticket/ticket-chip'
import { tagDotClass } from './ticket/ticket-style'

type WikiTag = { id: string; name: string; color: TagColor }

/** ツリーに出すドットの数。超えた分は `+n` にする */
const MAX_DOTS = 4

/** ページのタグ。押すとそのタグでスペース内を検索する */
export const WikiTagLinks: FC<{ spaceKey: string; tags: readonly WikiTag[]; size?: 'sm' | 'md' }> = ({
  spaceKey,
  tags,
  size = 'sm',
}) => {
  if (tags.length === 0) {
    return null
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {tags.map((tag) => (
        <Link key={tag.id} href={wikiSearchHref({ spaceKey, tags: [tag.name] })} className='hover:opacity-80'>
          <TagChip tag={tag} size={size} />
        </Link>
      ))}
    </div>
  )
}

/** 幅の狭いところ(サイドメニューのツリー)向けに、タグを色の点で示す。名前は title 属性と読み上げで出す */
export const WikiTagDots: FC<{ tags: readonly WikiTag[] }> = ({ tags }) => {
  if (tags.length === 0) {
    return null
  }
  const names = tags.map(({ name }) => name).join(', ')
  const rest = tags.length - MAX_DOTS
  return (
    <span className='flex shrink-0 items-center gap-0.5' title={names}>
      {tags.slice(0, MAX_DOTS).map((tag) => (
        <span key={tag.id} aria-hidden className={tagDotClass(tag.color)} />
      ))}
      {rest > 0 && (
        <span aria-hidden className='text-muted text-[10px] leading-none'>
          +{rest}
        </span>
      )}
      <span className='sr-only'>{names}</span>
    </span>
  )
}
