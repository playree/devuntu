'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { InputSearchField } from '@/components/general/input'
import { NoticePanel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon, MagnifyingGlassIcon } from '@/components/icon'
import { TagNameSelectField } from '@/components/ticket/tag-name-select'
import { useActionData } from '@/lib/action/action-client'
import { MAX_WIKI_PAGE_TAGS, MAX_WIKI_SEARCH_KEYWORD, wikiSearchHref } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { WikiSearchResults } from '../../search-results'
import { searchWikiPages } from '../../server'
import { useWikiSpace } from '../space-context'

/** スペース内の検索。キーワードとタグ(どれかを持つページ)で絞り込む */
export const WikiSpaceSearchClient: FC<{ keyword: string; tags: string[] }> = ({ keyword, tags }) => {
  const { t } = useLocale()
  const router = useRouter()
  const { space, access, tags: spaceTags } = useWikiSpace()
  const hasCondition = keyword !== '' || tags.length > 0
  const { data: hits, isLoading } = useActionData(() => searchWikiPages({ keyword, space: space.key, tags }), {
    key: JSON.stringify([space.key, keyword, tags]),
    skip: !hasCondition || !access.canView,
  })
  const search = (next: { q?: string; tags?: string[] }) =>
    router.replace(wikiSearchHref({ spaceKey: space.key, q: keyword, tags, ...next }))

  return (
    <FlexCol>
      <ContentHeader
        icon={<MagnifyingGlassIcon />}
        title={<span className='truncate'>{`${t('wiki_search')}: ${space.name}`}</span>}
      >
        <MultiButton
          isIconOnly
          tooltip={t('back')}
          icon={<ArrowLeftCircleIcon />}
          onPress={() => router.push(`/wiki/${space.key}`)}
        />
      </ContentHeader>

      {!access.canView ? (
        <NoticePanel>{t('msg_wiki_manage_only')}</NoticePanel>
      ) : (
        <>
          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <div className='min-w-0 flex-1'>
              <InputSearchField
                key={keyword} // URL の条件が変わったら(戻る・進む、タグのリンク)、入力欄もそれに合わせる
                isSmart
                aria-label={t('wiki_search')}
                placeholder={t('wiki_search_placeholder')}
                defaultValue={keyword}
                maxLength={MAX_WIKI_SEARCH_KEYWORD}
                onSubmit={(value) => search({ q: value.trim() })}
                onClear={() => search({ q: '' })}
              />
            </div>
            {spaceTags.length > 0 && (
              <div className='sm:w-64'>
                <TagNameSelectField
                  isSmart
                  isLabelHidden
                  options={spaceTags}
                  value={tags}
                  max={MAX_WIKI_PAGE_TAGS}
                  onChange={(next) => search({ tags: next })}
                />
              </div>
            )}
          </div>

          {hasCondition ? (
            <WikiSearchResults hits={hits} isLoading={isLoading} showSpace={false} />
          ) : (
            <p className='text-muted text-sm'>{t('msg_wiki_search_hint')}</p>
          )}
        </>
      )}
    </FlexCol>
  )
}
