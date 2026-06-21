'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { DashboardLayout } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import { Chip, cn } from '@heroui/react'
import { FC, ReactNode, useMemo, useState } from 'react'
import { updateDashboard } from './server'
import { WidgetDefaultLayout, WidgetMap, WidgetSet, WidgetStore } from './widget-client'

const DropArea: FC<{ children?: ReactNode; id: string; editable: boolean }> = ({ children, id, editable }) => {
  const { ref, isDropTarget } = useDroppable({
    id,
  })

  return (
    <div
      ref={ref}
      className={cn('col-span-12 min-h-20 md:col-span-6', isDropTarget ? 'rounded-3xl border-2 border-blue-300' : '')}
    >
      <div className={cn('h-full w-full p-0.5', editable ? 'rounded-3xl border-2 border-dashed' : '')}>{children}</div>
    </div>
  )
}

const DragItem: FC<{ id: string; editable: boolean; name: FC }> = ({ id, editable, name: Name }) => {
  const { ref } = useDraggable({
    id,
    disabled: !editable,
  })

  return (
    <Chip ref={ref} variant='soft' color='accent' size='lg' className='cursor-pointer'>
      <Chip.Label>
        <Name />
      </Chip.Label>
    </Chip>
  )
}

const AvailableArea: FC<{ editable: boolean; availableWidgets: WidgetSet[] }> = ({ editable, availableWidgets }) => {
  const { t } = useLocale()
  const { ref, isDropTarget } = useDroppable({ id: 'available' })

  return (
    <fieldset ref={ref} className={cn('mx-2 rounded-xl border-2 p-2', isDropTarget ? 'border-blue-300' : '')}>
      <legend className='px-2 text-sm text-gray-500'>{t('widget_list')}</legend>
      <div className='flex min-h-7 gap-2'>
        {availableWidgets.map((widget) => (
          <DragItem key={widget.id} id={widget.id} name={widget.name} editable={editable} />
        ))}
      </div>
    </fieldset>
  )
}

const DragDropArea: FC<{ initialLayout: DashboardLayout }> = ({ initialLayout }) => {
  const { t } = useLocale()
  const [isEditable, setEditable] = useState(false)
  const [layout, setLayout] = useState(initialLayout)
  const [layoutBackup, setLayoutBackup] = useState<DashboardLayout>()

  const availableWidgets = useMemo(() => {
    const usedList: string[] = []
    layout.left.forEach((value) => {
      if (value) {
        usedList.push(value)
      }
    })
    layout.right.forEach((value) => {
      if (value) {
        usedList.push(value)
      }
    })
    return WidgetStore.filter((widget) => !usedList.includes(widget.id))
  }, [layout])

  return (
    <>
      <DragDropProvider
        onDragEnd={(event) => {
          const sourceId = event.operation.source?.id.toString()
          const targetId = event.operation.target?.id.toString()
          console.debug('onDragEnd', { sourceId, targetId })

          if (sourceId && targetId) {
            if (targetId === 'available') {
              setLayout((current) => {
                const left = current.left.map((value) => (value === sourceId ? null : value))
                const right = current.right.map((value) => (value === sourceId ? null : value))
                return { left, right }
              })
            } else {
              const target = targetId.split('-')
              const lr = target[0]
              const pos = Number(target[1])
              setLayout((current) => {
                const left = current.left.map((value) => (value === sourceId ? null : value))
                const right = current.right.map((value) => (value === sourceId ? null : value))
                if (lr === 'l') {
                  left[pos] = sourceId.toString()
                } else {
                  right[pos] = sourceId.toString()
                }
                return { left, right }
              })
            }
          }
        }}
      >
        <div className='flex justify-between'>
          <div className='flex-1 gap-2'>
            {isEditable && <AvailableArea editable={isEditable} availableWidgets={availableWidgets} />}
          </div>
          {isEditable ? (
            <div className='flex gap-2'>
              <MultiButton
                size='sm'
                icon={<CheckIcon />}
                onPress={async () => {
                  setEditable(false)
                  await parseAction(updateDashboard({ layout }))
                  notify.success(t('msg_saved'))
                }}
              >
                {t('save')}
              </MultiButton>
              <MultiButton
                variant='ghost'
                size='sm'
                onPress={() => {
                  if (layoutBackup) {
                    setLayout(layoutBackup)
                  }
                  setEditable(false)
                }}
              >
                {t('cancel')}
              </MultiButton>
            </div>
          ) : (
            <MultiButton
              variant='outline'
              size='sm'
              icon={<PencilSquareIcon />}
              onPress={() => {
                setLayoutBackup(layout)
                setEditable(true)
              }}
            >
              {t('edit_dashboard')}
            </MultiButton>
          )}
        </div>

        <GridBox>
          <FlexCol className='col-span-12 md:col-span-6'>
            {layout.left.map((widgetId, index) => {
              const ariaId = `l-${index}`
              const Widget = widgetId ? WidgetMap[widgetId].widget : null
              return (
                <DropArea key={ariaId} id={ariaId} editable={isEditable}>
                  {widgetId && Widget && <Widget id={widgetId} editable={isEditable} />}
                </DropArea>
              )
            })}
          </FlexCol>
          <FlexCol className='col-span-12 md:col-span-6'>
            {layout.right.map((widgetId, index) => {
              const ariaId = `r-${index}`
              const Widget = widgetId ? WidgetMap[widgetId].widget : null
              return (
                <DropArea key={ariaId} id={ariaId} editable={isEditable}>
                  {widgetId && Widget && <Widget id={widgetId} editable={isEditable} />}
                </DropArea>
              )
            })}
          </FlexCol>
        </GridBox>
      </DragDropProvider>
    </>
  )
}

export const HomeClient: FC<{ layout: DashboardLayout | undefined | null }> = ({ layout }) => {
  return (
    <FlexCol>
      <DragDropArea initialLayout={layout ?? WidgetDefaultLayout} />
    </FlexCol>
  )
}
