import { MultiButton } from '@/components/general/button'
import { useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { Fragment, ReactNode, useState } from 'react'

type Template = { id: string; name: string }

type TemplateListEditorProps<T extends Template> = {
  templates: readonly T[]
  description: string
  limit: number
  canManage: boolean
  onDelete: (id: string) => Promise<unknown>
  onMove?: (id: string, direction: 'up' | 'down') => Promise<unknown>
  reload: () => Promise<void>
  renderBadge?: (template: T) => ReactNode
  renderDetails: (template: T) => ReactNode
  renderModal: (state: ReturnType<typeof useModalState<T>>) => ReactNode
}

export const TemplateListEditor = <T extends Template>({
  templates,
  description,
  limit,
  canManage,
  onDelete,
  onMove,
  reload,
  renderBadge,
  renderDetails,
  renderModal,
}: TemplateListEditorProps<T>) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()
  const modalState = useModalState<T>()
  const [isMoving, setMoving] = useState(false)

  const move = async (id: string, direction: 'up' | 'down') => {
    setMoving(true)
    try {
      await onMove?.(id, direction)
      await reload()
    } finally {
      setMoving(false)
    }
  }

  const remove = ({ id, name }: T) =>
    confirmAction({ title: t('confirm_deletion'), text: t('msg_confirm_deletion', { target: name }) }, async () => {
      await onDelete(id)
      notify.success(t('msg_deleted_target', { target: name }))
      reload()
    })

  return (
    <div className='space-y-2'>
      <NoticePanel className='text-xs'>{description}</NoticePanel>
      {canManage && (
        <MultiButton
          size='sm'
          variant='outline'
          icon={<PlusIcon width={16} />}
          isDisabled={templates.length >= limit}
          onPress={() => modalState.open()}
        >
          {t('template_add')}
        </MultiButton>
      )}
      {templates.length === 0 ? (
        <div className='text-muted flex items-center gap-1 px-1 text-sm'>
          <DocumentDuplicateIcon width={16} />
          {t('template_empty')}
        </div>
      ) : (
        <div className='space-y-1'>
          {templates.map((template, index) => (
            <div key={template.id} className='flex items-start gap-2 rounded-xl border-2 px-2 py-1'>
              <div className='min-w-0 grow space-y-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm font-medium wrap-break-word'>{template.name}</span>
                  {renderBadge?.(template)}
                </div>
                {renderDetails(template)}
              </div>
              {canManage && (
                <div className='flex shrink-0 items-center gap-0.5'>
                  {onMove && (
                    <>
                      <MultiButton
                        isIconOnly
                        size='sm'
                        variant='ghost'
                        tooltip={t('move_up')}
                        icon={<ChevronUpIcon width={16} />}
                        isDisabled={index === 0 || isMoving}
                        onPress={() => move(template.id, 'up')}
                      />
                      <MultiButton
                        isIconOnly
                        size='sm'
                        variant='ghost'
                        tooltip={t('move_down')}
                        icon={<ChevronDownIcon width={16} />}
                        isDisabled={index === templates.length - 1 || isMoving}
                        onPress={() => move(template.id, 'down')}
                      />
                    </>
                  )}
                  <MultiButton
                    isIconOnly
                    size='sm'
                    variant='ghost'
                    tooltip={t('update')}
                    icon={<PencilSquareIcon width={16} />}
                    onPress={() => modalState.open(template)}
                  />
                  <MultiButton
                    isIconOnly
                    size='sm'
                    variant='ghost'
                    tooltip={t('delete')}
                    icon={<TrashIcon width={16} />}
                    onPress={() => remove(template)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canManage && <Fragment key={modalState.key}>{renderModal(modalState)}</Fragment>}
    </div>
  )
}
