'use client'

import { ActionCell } from '@/components/action-cell'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CalendarDaysIcon, PencilSquareIcon, PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { minToHHmm, WEEKDAY_LABELS } from '@/lib/day'
import { UpdateBusyTime } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { ButtonGroup, Chip, Table } from '@heroui/react'
import { FC } from 'react'
import { BusyTimeModal } from './busy-modals'
import { deleteBusyTime, getBusyTimes } from './server'

/** 月始まりの表示順(値は dayjs .day() のインデックス 0=日..6=土) */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export const BusyTimeManage: FC = () => {
  const { t, locale } = useLocale()
  const labels = WEEKDAY_LABELS[locale] ?? WEEKDAY_LABELS.ja
  const modalState = useModalState<UpdateBusyTime>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getBusyTimes())
      return res ?? []
    },
    sort: {
      init: { column: 'createdAt', direction: 'descending' },
    },
  })

  const timeLabel = (startMin: number, endMin: number) => `${minToHHmm(startMin)} - ${minToHHmm(endMin)}`

  return (
    <FlexCol>
      <ContentHeader icon={<CalendarDaysIcon />} title={t('busy_time_manage')}>
        <MultiButton isIconOnly size='sm' tooltip={t('add_busy_time')} onPress={() => modalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly size='sm' tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='busy time list'
        pagingList={list}
        columns={[
          { id: 'title', name: t('title'), isRowHeader: true, minWidth: 120, defaultWidth: '2fr' },
          { id: 'weekdays', name: t('weekday'), minWidth: 120, defaultWidth: '1fr' },
          { id: 'time', name: t('time_range'), defaultWidth: 150 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell className='truncate'>{item.title}</Table.Cell>
            <Table.Cell>
              <div className='flex flex-wrap gap-1'>
                {WEEKDAY_ORDER.filter((d) => item.weekdays.includes(d)).map((d) => (
                  <Chip key={d} variant='soft' color='accent'>
                    {labels[d]}
                  </Chip>
                ))}
              </div>
            </Table.Cell>
            <Table.Cell className='font-mono text-sm'>{timeLabel(item.startMin, item.endMin)}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    modalState.open({
                      id: item.id,
                      title: item.title,
                      weekdays: item.weekdays,
                      startMin: item.startMin,
                      endMin: item.endMin,
                    })
                  },
                },
                {
                  template: 'delete',
                  target: item.title,
                  action: async () => {
                    await parseAction(deleteBusyTime({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.title }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <BusyTimeModal state={modalState} reload={list.reload} target={modalState.target} key={modalState.key} />
    </FlexCol>
  )
}
