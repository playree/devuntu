'use client'

import { MultiButton } from '@/components/general/button'
import { CheckIcon, ChevronDownIcon } from '@/components/general/icons'
import { NoticePanel } from '@/components/general/panel'
import { ArrowUturnLeftIcon, TrashIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { RevisionFieldChange } from '@/components/revision-diff'
import { UpdatedBy } from '@/components/updated-by'
import type { WikiPageType } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { ticketShortPath } from '@/lib/board/ticket-id'
import { dayformat } from '@/lib/day'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { resolveWikiRevisionTags, wikiRevisionTagLabels, type WikiRevisionTag } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { Button, Chip, cn, Dropdown } from '@heroui/react'
import Link from 'next/link'
import { FC, useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  deleteWikiPageRevision,
  getWikiPageRevisionContent,
  getWikiPageRevisions,
  restoreWikiPageRevision,
  type GetWikiPageRevisionsReturnType,
} from '../server'
import { useWikiSpace } from '../space-context'
import type { GetWikiPageReturnType } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']
type Revision = NonNullable<GetWikiPageRevisionsReturnType>['revisions'][number]

/**
 * ページの版の一覧と、選んでいる版。最新の版はいまの内容と同じなので、過去の版(`past`)を選んだときだけ本文を引く。
 * 一覧は同じ時点のページの更新日時を持つので、表示中のページと照合し、ずれていれば古いほう(一覧かページ)を取り直す。
 * 移動は更新日時を進めずに版だけを足すので、更新日時が同じなら最新の版の番号で比べる。
 * そろうまでは一覧を出さない(版の表示と内容が別の版を指さないように)
 */
export const useWikiPageRevisions = (page: Page, reloadPage: () => Promise<void>) => {
  const { t } = useLocale()
  const { data, refresh } = useActionData(() => getWikiPageRevisions({ id: page.id }), { key: page.id })
  const updatedAt = page.updatedAt.getTime()
  const listPageAt = data ? (data.pageUpdatedAt?.getTime() ?? null) : undefined
  const listRevisionNumber = data?.revisions[0]?.number ?? 0
  const isSynced = listPageAt === updatedAt && listRevisionNumber === page.revisionNumber
  /**
   * 取り直しは、ページか一覧を新しく受け取るたびに1回だけ行う。取得に失敗すると前の値のまま残るので、失敗しても繰り返さない。
   * 画面の再読み込みボタンでページを取り直せば(更新日時が同じでも)もう一度試す
   */
  const tried = useRef<{ page: Page; list: typeof data } | null>(null)
  const syncLatest = useEffectEvent((older: 'list' | 'page') => (older === 'list' ? refresh() : reloadPage()))
  useEffect(() => {
    if (listPageAt === undefined || isSynced) {
      return
    }
    if (tried.current?.page !== page || tried.current.list !== data) {
      tried.current = { page, list: data }
      // 一覧のほうが新しい(他の人の保存・移動・ページの削除)ならページを、ページのほうが新しい(保存・ロールバック・移動)なら一覧を取り直す
      const isListNewer =
        listPageAt === null ||
        listPageAt > updatedAt ||
        (listPageAt === updatedAt && listRevisionNumber > page.revisionNumber)
      void syncLatest(isListNewer ? 'page' : 'list')
    }
  }, [listPageAt, listRevisionNumber, updatedAt, isSynced, page, data])
  const reload = async () => {
    await Promise.all([refresh(), reloadPage()])
  }

  const revisions = isSynced && data ? data.revisions : []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 選んだ過去の版から最新への差分を出すか。過去の版を選び直しても保ち、選択を外すと戻す
  const [isDiffOn, setDiffOn] = useState(false)
  // 選び直すたびに本文を引き直す(同じ版を選び直したときも、前回の失敗を引きずらない)
  const [attempt, setAttempt] = useState(0)
  // 一覧から消えた版(削除・掃除)を選んでいたら最新に戻る
  const selected = revisions.find(({ id }) => id === selectedId)
  const past = selected && selected.id !== revisions[0]?.id ? selected : undefined
  const contentKey = past ? `${past.id}#${attempt}` : undefined
  const content = useActionData(() => getWikiPageRevisionContent({ id: past?.id ?? '' }), {
    skip: !past,
    key: contentKey,
  })
  // 本文を引けなかった(他の人の削除や掃除で版が消えた)ら、最新に戻して取り直す
  const [missingKey, setMissingKey] = useState<string | null>(null)
  if (contentKey && !content.isLoading && content.data === undefined && missingKey !== contentKey) {
    setMissingKey(contentKey)
    setSelectedId(null)
    setDiffOn(false)
  }
  const onMissing = useEffectEvent(() => {
    notify.error(t('msg_invalid_operation'))
    void reload()
  })
  useEffect(() => {
    if (missingKey) {
      onMissing()
    }
  }, [missingKey])

  return {
    revisions,
    retention: data,
    past,
    pastContent: past ? content.data : undefined,
    isDiff: isDiffOn && !!past,
    setDiff: setDiffOn,
    // 最新の版を選んだときは選択を外す(新しい版ができても最新を表示し続ける)
    select: (id: string | null) => {
      const next = id === revisions[0]?.id ? null : id
      if (next !== selectedId) {
        setSelectedId(next)
        setAttempt((n) => n + 1)
      }
      // 最新の表示から(版が消えて戻った場合も含む)選んだときは、差分ではなく版の内容から始める
      if (next === null || !past) {
        setDiffOn(false)
      }
    },
    reload,
  }
}

export type WikiPageRevisions = ReturnType<typeof useWikiPageRevisions>

/** 版の内容(過去の版)で表示するタイトル・種類・タグ。タグは ID で、いまスペースに残っているものを今の名前で出す */
export const usePastPageView = (past: Revision | undefined) => {
  const { tags } = useWikiSpace()
  if (!past) {
    return undefined
  }
  return {
    id: past.id,
    number: past.number,
    revisionTags: past.tags,
    title: past.title,
    type: past.type,
    tags: resolveWikiRevisionTags(past.tags, tags),
  }
}

const RevisionNumber: FC<{ number: number }> = ({ number }) => (
  <span className='text-muted font-mono text-xs'>v{number}</span>
)

/** 版の一覧の1項目 */
const RevisionItem: FC<{ revision: Revision; revisions: readonly Revision[]; isLatest: boolean }> = ({
  revision,
  revisions,
  isLatest,
}) => {
  const { t } = useLocale()
  const source = revision.restoredFromId && revisions.find(({ id }) => id === revision.restoredFromId)
  return (
    <div className='min-w-0 space-y-0.5'>
      <div // チェックの位置(1行目の中央)を合わせるため、Chip の有無によらず高さをそろえる
        className='flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'
      >
        <RevisionNumber number={revision.number} />
        {t(`wiki_revision_action_${revision.action}`)}
        {source && (
          <span className='text-muted text-xs'>{t('wiki_revision_restored_from', { version: source.number })}</span>
        )}
        {isLatest && (
          <Chip color='accent' variant='soft' size='sm'>
            <Chip.Label>{t('wiki_revision_latest')}</Chip.Label>
          </Chip>
        )}
        {revision.beforeRetention && (
          <Chip color='warning' variant='soft' size='sm'>
            <Chip.Label>{t('wiki_revision_before_retention')}</Chip.Label>
          </Chip>
        )}
        {revision.ticketDisplayId && <span className='text-muted text-xs'>{revision.ticketDisplayId}</span>}
        <UpdatedBy
          name={revision.actorName}
          isAgent={revision.actorIsAgent}
          via={revision.via}
          at={revision.updatedAt}
        />
      </div>
      {revision.message && <p className='line-clamp-2 text-xs break-all whitespace-pre-line'>{revision.message}</p>}
    </div>
  )
}

const revisionButton = 'h-auto min-h-0 gap-1 px-2 py-0.5 text-xs font-normal whitespace-normal'

/**
 * 更新者・日時を兼ねた版の選択。選んでいる版(既定は最新)の版数・更新者・日時を出す。
 * 版が取れていなければ(取得中・ページとの照合中・旧データ)同じ形のまま押せないボタンで文言だけを出す。
 * 過去の版を選んでいる間は注意色にする
 */
export const WikiRevisionSelect: FC<{ revisions: WikiPageRevisions; updatedText: string }> = ({
  revisions: { revisions, past, select },
  updatedText,
}) => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  if (revisions.length === 0) {
    return (
      <Button variant='outline' size='sm' isDisabled className={cn(revisionButton, 'text-muted')}>
        {updatedText}
      </Button>
    )
  }
  const current = past ?? revisions[0]
  const label = `v${current.number} · ${t('wiki_updated_by', { name: current.actorName || '-', at: dayformat(current.updatedAt, 'tz-minute', tz) })}`
  return (
    <Dropdown>
      <Button
        variant='outline'
        size='sm'
        aria-label={`${t('history')}: ${label}`}
        className={cn(revisionButton, past ? 'text-warning border-warning' : 'text-muted')}
      >
        {label}
        <ChevronDownIcon width={12} className='shrink-0' />
      </Button>
      <Dropdown.Popover className='w-[min(28rem,calc(100vw-2rem))]'>
        <Dropdown.Menu
          aria-label={t('history')}
          className='max-h-[60vh] overflow-y-auto'
          disallowEmptySelection
          selectionMode='single'
          selectedKeys={[current.id]}
          onAction={(key) => select(String(key))}
        >
          {revisions.map((revision, index) => (
            <Dropdown.Item
              key={revision.id}
              id={revision.id}
              textValue={`v${revision.number}`}
              className='min-h-min py-1'
            >
              <Dropdown.ItemIndicator
                /**
                 * 既定は項目の縦中央。メッセージの2行目があってもずれないよう、1行目の中央(py-1 + min-h-5 の半分)に置く。
                 * 既定のチェック(10px の線画)は細くかすれて見えるので、塗りのアイコンにする
                 */
                className='top-3.5'
              >
                {({ isSelected }) => isSelected && <CheckIcon width={14} />}
              </Dropdown.ItemIndicator>
              <RevisionItem revision={revision} revisions={revisions} isLatest={index === 0} />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

/** 選んでいる過去の版から最新への差分の表示の切り替え。過去の版を選んでいる間だけ出す */
export const WikiRevisionDiffToggle: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, isDiff, setDiff },
}) => {
  const { t } = useLocale()
  if (!past) {
    return null
  }
  return (
    <Button
      variant={isDiff ? 'primary' : 'outline'}
      size='sm'
      aria-pressed={isDiff}
      className='shrink-0'
      onPress={() => setDiff(!isDiff)}
    >
      {t('wiki_diff')}
    </Button>
  )
}

/** タグは ID で比べ、今の名前で出す(過去の版のタグは、その後に削除されていても版の名前に削除済みの印を付けて出る) */
type RevisionFields = { title: string; type: WikiPageType; tags: readonly WikiRevisionTag[] }

const isSameTags = (a: readonly WikiRevisionTag[], b: readonly WikiRevisionTag[]) => {
  const idsOfB = new Set(b.map(({ id }) => id))
  return a.length === b.length && a.every(({ id }) => idsOfB.has(id))
}

const tagText = (names: readonly string[]) => [...names].sort().join(', ') || '-'

/** 差分の表示中に、本文の差分とは別に、選んだ過去の版から最新までに変わったタイトル・種類・タグを出す */
export const WikiRevisionFieldChanges: FC<{ before: RevisionFields; after: RevisionFields }> = ({ before, after }) => {
  const { t } = useLocale()
  const { tags } = useWikiSpace()
  const deletedTag = (name: string) => t('wiki_deleted_tag', { name })
  const changes = [
    before.title !== after.title && (
      <RevisionFieldChange key='title' label={t('wiki_page_title')} before={before.title} after={after.title} />
    ),
    before.type !== after.type && (
      <RevisionFieldChange
        key='type'
        label={t('wiki_page_type')}
        before={t(`wiki_page_type_${before.type}`)}
        after={t(`wiki_page_type_${after.type}`)}
      />
    ),
    !isSameTags(before.tags, after.tags) && (
      <RevisionFieldChange
        key='tags'
        label={t('tags')}
        before={tagText(wikiRevisionTagLabels(before.tags, tags, deletedTag))}
        after={tagText(wikiRevisionTagLabels(after.tags, tags, deletedTag))}
      />
    ),
  ].filter(Boolean)
  return changes.length > 0 && <div className='space-y-1'>{changes}</div>
}

/**
 * 過去の版のロールバック(編集者以上)。タイトル・種類・本文・タグだけを戻し、位置は変えない。終わったら最新の版の表示に戻す
 */
export const WikiRevisionRestoreButton: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, select, reload },
}) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  if (!past) {
    return null
  }

  const restore = () =>
    confirmAction(
      { title: t('restore'), text: t('msg_confirm_restore_wiki_page', { target: past.title }) },
      async () => {
        const result = await parseAction(restoreWikiPageRevision({ id: past.id }))
        if (result.result === 'unchanged') {
          notify.info(t('msg_wiki_restore_unchanged'))
          return
        }
        notify.success(t('msg_restored_target', { target: past.title }))
        select(null)
        await reload()
      },
    )

  return (
    <MultiButton
      isIconOnly
      size='sm'
      variant='outline'
      tooltip={t('wiki_restore_this')}
      icon={<ArrowUturnLeftIcon width={16} />}
      onPress={restore}
    />
  )
}

/** 過去の版の削除(`canDeleteWikiRevision`)。終わったら最新の版の表示に戻す */
export const WikiRevisionDeleteButton: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, select, reload },
}) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  if (!past) {
    return null
  }

  const remove = () =>
    confirmAction(
      { title: t('delete'), text: t('msg_confirm_delete_wiki_revision', { target: `v${past.number}` }) },
      async () => {
        await parseAction(deleteWikiPageRevision({ id: past.id }))
        notify.success(t('msg_deleted_target', { target: `v${past.number}` }))
        select(null)
        await reload()
      },
    )

  return (
    <MultiButton // ヘッダーのページの削除(アイコンのみ)と見分けられるよう、文言を出す
      size='sm'
      variant='danger-soft'
      className='shrink-0'
      icon={<TrashIcon width={16} />}
      onPress={remove}
    >
      {t('wiki_delete_revision')}
    </MultiButton>
  )
}

/** 過去の版を表示していることの注記。コミットメッセージ・チケット・版の保持期間も添える */
export const WikiPastRevisionNotice: FC<{ revisions: WikiPageRevisions }> = ({
  revisions: { past, retention, isDiff },
}) => {
  const { t } = useLocale()
  if (!past) {
    return null
  }
  return (
    <NoticePanel status='warning'>
      {t(isDiff ? 'msg_wiki_viewing_diff' : 'msg_wiki_viewing_revision', { target: `v${past.number}` })}
      {past.ticketDisplayId && (
        <>
          {' '}
          <Link className='text-accent' href={ticketShortPath(past.ticketDisplayId)}>
            {past.ticketDisplayId}
          </Link>
        </>
      )}
      {past.message && `\n${past.message}`}
      {`\n${t('msg_wiki_revision_retention', {
        days: retention?.retentionDays ?? '-',
        keep: retention?.keepRecent ?? '-',
        max: retention?.maxPerPage ?? '-',
      })}`}
    </NoticePanel>
  )
}
