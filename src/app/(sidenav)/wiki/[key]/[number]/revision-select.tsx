import { CheckIcon, ChevronDownIcon } from '@/components/general/icons'
import { UpdatedBy } from '@/components/updated-by'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { Button, Chip, cn, Dropdown } from '@heroui/react'
import { FC } from 'react'
import type { WikiPageRevision, WikiPageRevisions } from './use-wiki-page-revisions'

const RevisionNumber: FC<{ number: number }> = ({ number }) => (
  <span className='text-muted font-mono text-xs'>v{number}</span>
)

/** 版の一覧の1項目 */
const RevisionItem: FC<{ revision: WikiPageRevision; revisions: readonly WikiPageRevision[]; isLatest: boolean }> = ({
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
