'use client'

import { Grid } from '@/components/general/grid'
import { InputField } from '@/components/general/input'
import { SingleSelectField } from '@/components/general/select'
import { TagIdSelectField } from '@/components/ticket/tag-id-select'
import { useWikiPageTypeOptions } from '@/components/wiki-chip'
import type { WikiPageType } from '@/generated/prisma/enums'
import { parseAction } from '@/lib/action/action-client'
import { MAX_WIKI_TITLE } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { createWikiTag } from '../server'
import { useWikiSpace } from '../space-context'

/** 編集中のタイトル・種類・タグ */
export const WikiPageEditHeader: FC<{
  title: string
  onTitleChange: (title: string) => void
  type: WikiPageType
  onTypeChange: (type: WikiPageType) => void
  tagIds: string[]
  onTagIdsChange: (tagIds: string[]) => void
}> = ({ title, onTitleChange, type, onTypeChange, tagIds, onTagIdsChange }) => {
  const { t } = useLocale()
  const { space, tags: spaceTags, reloadSpace } = useWikiSpace()
  const typeOptions = useWikiPageTypeOptions()

  return (
    <Grid isSmart className='items-start'>
      <div className='col-span-12 md:col-span-5'>
        <InputField
          label={t('wiki_page_title')}
          value={title}
          maxLength={MAX_WIKI_TITLE}
          onChange={(e) => onTitleChange(e.target.value)}
          errorMessage={title.trim() === '' ? t('@invalid_wiki_title') : undefined}
        />
      </div>
      <div className='col-span-12 md:col-span-2'>
        <SingleSelectField
          label={t('wiki_page_type')}
          groupOptions={typeOptions}
          value={type}
          onChange={(key) => key && onTypeChange(key as WikiPageType)}
        />
      </div>
      <div className='col-span-12 md:col-span-5'>
        <TagIdSelectField
          options={spaceTags}
          value={tagIds}
          onChange={onTagIdsChange}
          onCreate={async (name) => {
            const tag = await parseAction(createWikiTag({ spaceId: space.id, name }))
            // 選択欄が覚えている作成済みのタグは編集を閉じると消えるので、スペースのタグ(選択肢・ツリー)も取り直す
            await reloadSpace()
            return tag
          }}
        />
      </div>
    </Grid>
  )
}
