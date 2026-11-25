import { RevisionChanges, type RevisionChange } from '@/components/revision-diff'
import type { WikiPageType } from '@/generated/prisma/enums'
import { isSameSet } from '@/lib/list-compare'
import { wikiRevisionTagLabels, type WikiRevisionTag } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { useWikiSpace } from '../space-context'

/** タグは ID で比べ、今の名前で出す(過去の版のタグは、その後に削除されていても版の名前に削除済みの印を付けて出る) */
type RevisionFields = { title: string; type: WikiPageType; tags: readonly WikiRevisionTag[] }

const isSameTags = (a: readonly WikiRevisionTag[], b: readonly WikiRevisionTag[]) =>
  isSameSet(
    a.map(({ id }) => id),
    b.map(({ id }) => id),
  )

const tagText = (names: readonly string[]) => [...names].sort().join(', ') || '-'

/** 差分の表示中に、本文の差分とは別に、選んだ過去の版から最新までに変わったタイトル・種類・タグを出す */
export const WikiRevisionFieldChanges: FC<{ before: RevisionFields; after: RevisionFields }> = ({ before, after }) => {
  const { t } = useLocale()
  const { tags } = useWikiSpace()
  const deletedTag = (name: string) => t('wiki_deleted_tag', { name })
  const changes = (
    [
      before.title !== after.title && {
        id: 'title',
        label: t('wiki_page_title'),
        before: before.title,
        after: after.title,
      },
      before.type !== after.type && {
        id: 'type',
        label: t('wiki_page_type'),
        before: t(`wiki_page_type_${before.type}`),
        after: t(`wiki_page_type_${after.type}`),
      },
      !isSameTags(before.tags, after.tags) && {
        id: 'tags',
        label: t('tags'),
        before: tagText(wikiRevisionTagLabels(before.tags, tags, deletedTag)),
        after: tagText(wikiRevisionTagLabels(after.tags, tags, deletedTag)),
      },
    ] satisfies (RevisionChange | false)[]
  ).filter((change) => change !== false)
  return <RevisionChanges changes={changes} className='space-y-1' />
}
