'use client'

import { NoticePanel } from '@/components/general/panel'
import { useLocale } from '@/locale/client'
import { useDraggable } from '@dnd-kit/react'
import { Card, cn, Separator, Skeleton } from '@heroui/react'
import Link from 'next/link'
import { ComponentProps, FC, ReactNode } from 'react'

export type WidgetFC = FC<{ id: string; editable: boolean }>

/** Widget 共通のカード。編集モードではカード全体をドラッグできる */
export const WidgetCard: FC<{
  id: string
  editable: boolean
  icon: ReactNode
  title: ReactNode
  className?: string
  children: ReactNode
}> = ({ id, editable, icon, title, className, children }) => {
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })

  return (
    <Card ref={ref} className={cn('w-full gap-1 py-2', className)}>
      <Card.Header>
        <div className='flex gap-1 font-bold'>
          {icon}
          {title}
        </div>
      </Card.Header>
      <Card.Content>
        <Separator className='my-1' />
        {children}
      </Card.Content>
    </Card>
  )
}

/** 取得中の表示 */
const WidgetSkeleton: FC = () => <Skeleton className='h-full min-h-14 w-full rounded-xl' />

/** 取得に失敗したときの表示 */
const WidgetLoadError: FC = () => {
  const { t } = useLocale()
  return <NoticePanel status='danger'>{t('msg_widget_load_failed')}</NoticePanel>
}

/**
 * 取得したデータを表示する WidgetCard。取得中はスケルトン、取得後もデータが無ければ失敗の表示にする
 * (Action が null を返した場合も失敗として扱う)
 */
export const WidgetDataCard = <T,>({
  data,
  isLoading,
  children,
  ...cardProps
}: Omit<ComponentProps<typeof WidgetCard>, 'children'> & {
  data: T | null | undefined
  isLoading: boolean
  children: (data: T) => ReactNode
}) => (
  <WidgetCard {...cardProps}>{data ? children(data) : isLoading ? <WidgetSkeleton /> : <WidgetLoadError />}</WidgetCard>
)

/** Widget 内の行一覧。0 件なら message を出す */
export const WidgetRowList: FC<{ isEmpty: boolean; message: string; children: ReactNode }> = ({
  isEmpty,
  message,
  children,
}) => {
  if (isEmpty) {
    return <div className='text-muted min-h-14 px-2 py-1 text-sm'>{message}</div>
  }
  return <div className='flex max-h-64 min-h-14 flex-col overflow-y-auto'>{children}</div>
}

/**
 * Widget 内のリンク。編集モード中はドラッグ操作と衝突しないよう遷移させず、同じ見た目の div にする
 */
export const EditableLink: FC<{
  href: string
  editable: boolean
  className?: string
  /** 外部リンクは新しいタブで開く */
  isExternal?: boolean
  children: ReactNode
}> = ({ href, editable, className, isExternal, children }) => {
  if (editable) {
    return <div className={className}>{children}</div>
  }
  return (
    <Link href={href} className={className} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </Link>
  )
}
