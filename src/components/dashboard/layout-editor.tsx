'use client'

import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { DashboardLayout } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import { Chip, cn } from '@heroui/react'
import { Dispatch, FC, ReactNode, SetStateAction, useMemo } from 'react'
import { useWidgetMap, WidgetSet } from './widget'

const DropArea: FC<{ children?: ReactNode; id: string; editable: boolean }> = ({ children, id, editable }) => {
  const { ref, isDropTarget } = useDroppable({
    id,
  })

  return (
    <div
      ref={ref}
      className={cn('col-span-12 min-h-14 md:col-span-6', isDropTarget ? 'rounded-3xl border-2 border-blue-300' : '')}
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

/**
 * ドラッグ&ドロップでウィジェット配置を編集する共有エディタ。
 * レイアウトの state は呼び出し側が保持し、編集可否も外部から制御する。
 */
export const DashboardLayoutEditor: FC<{
  layout: DashboardLayout
  setLayout: Dispatch<SetStateAction<DashboardLayout>>
  editable: boolean
}> = ({ layout, setLayout, editable }) => {
  const widgetMap = useWidgetMap()

  const widgetStore = useMemo<WidgetSet[]>(
    () => Object.entries(widgetMap).map(([id, props]) => ({ ...props, id })),
    [widgetMap],
  )

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
    return widgetStore.filter((widget) => !usedList.includes(widget.id))
  }, [layout, widgetStore])

  return (
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
      {editable && (
        <div className='mb-2'>
          <AvailableArea editable={editable} availableWidgets={availableWidgets} />
        </div>
      )}

      <GridBox>
        <FlexCol className='col-span-12 md:col-span-6'>
          {layout.left.map((widgetId, index) => {
            const ariaId = `l-${index}`
            const Widget = widgetId ? widgetMap[widgetId]?.widget : null
            if (!editable && !widgetId) {
              return null
            }
            return (
              <DropArea key={ariaId} id={ariaId} editable={editable}>
                {widgetId && Widget && <Widget id={widgetId} editable={editable} />}
              </DropArea>
            )
          })}
        </FlexCol>
        <FlexCol className='col-span-12 md:col-span-6'>
          {layout.right.map((widgetId, index) => {
            const ariaId = `r-${index}`
            const Widget = widgetId ? widgetMap[widgetId]?.widget : null
            if (!editable && !widgetId) {
              return null
            }
            return (
              <DropArea key={ariaId} id={ariaId} editable={editable}>
                {widgetId && Widget && <Widget id={widgetId} editable={editable} />}
              </DropArea>
            )
          })}
        </FlexCol>
      </GridBox>
    </DragDropProvider>
  )
}
