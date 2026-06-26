'use client'

import { ActionCell } from '@/components/action-cell'
import { DashboardLayoutEditor } from '@/components/dashboard/layout-editor'
import { FileInputCtrl } from '@/components/file-input-ctrl'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input-ctrl'
import { FormModal, ModalBaseProps, useModalState } from '@/components/general/modal'
import { usePagingList } from '@/components/general/paging'
import { MultiTable } from '@/components/general/table'
import { ContentHeader } from '@/components/header'
import {
  ArrowPathIcon,
  CheckIcon,
  PencilSquareIcon,
  PlusIcon,
  PuzzlePieceIcon,
  Squares2X2Icon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import {
  CreateLinkWidget,
  DashboardLayout,
  scCreateLinkWidget,
  scUpdateLinkWidget,
  UpdateLinkWidget,
  WidgetDefaultLayout,
} from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup, Modal, Table } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import Image from 'next/image'
import { FC, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  createLinkWidget,
  deleteLinkWidget,
  getDefaultDashboard,
  getLinkWidgets,
  updateDefaultDashboard,
  updateLinkWidget,
} from './server'

type LinkWidgetTarget = Omit<UpdateLinkWidget, 'icon' | 'description'> & {
  description: string | null
  iconPath: string | null
}

const LinkWidgetAddModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateLinkWidget>({
    resolver: zodResolver(scCreateLinkWidget),
    mode: 'onChange',
    defaultValues: {
      name: '',
      url: '',
      description: '',
      icon: undefined,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(createLinkWidget(req))
        notify.success(t('msg_added_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('add_link'), icon: <PlusIcon /> }}
      hooter={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='name'
            label={t('name')}
            errorMessage={fet(errors.name)}
            isRequired
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='url'
            label={t('url')}
            errorMessage={fet(errors.url)}
            isRequired
          />
        </div>
        <div className='col-span-12'>
          <FileInputCtrl
            control={control}
            variant='tertiary'
            name='icon'
            label={t('icon')}
            errorMessage={fet(errors.icon)}
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='description'
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

const LinkWidgetUpdateModal: FC<ModalBaseProps & { target: LinkWidgetTarget }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateLinkWidget>({
    resolver: zodResolver(scUpdateLinkWidget),
    mode: 'onChange',
    defaultValues: {
      id: target.id,
      name: target.name,
      url: target.url,
      description: target.description ?? '',
      icon: undefined,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        const res = await parseAction(updateLinkWidget(req))
        notify.success(t('msg_updated_target', { target: res.name }))
        reload()
        state.close()
      })}
      title={{ text: t('update'), icon: <PencilSquareIcon /> }}
      hooter={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='name'
            label={t('name')}
            errorMessage={fet(errors.name)}
            isRequired
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='url'
            label={t('url')}
            errorMessage={fet(errors.url)}
            isRequired
          />
        </div>
        <div className='col-span-12'>
          <FileInputCtrl
            control={control}
            variant='tertiary'
            name='icon'
            label={t('icon')}
            errorMessage={fet(errors.icon)}
            existingUrl={target.iconPath}
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            variant='secondary'
            name='description'
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

export const LinkWidgetManage: FC = () => {
  const { t } = useLocale()
  const addModalState = useModalState()
  const updateModalState = useModalState<LinkWidgetTarget>()

  const list = usePagingList({
    load: async () => {
      const res = await parseAction(getLinkWidgets())
      return res ?? []
    },
    sort: {
      init: { column: 'updatedAt', direction: 'descending' },
    },
  })

  return (
    <FlexCol>
      <ContentHeader>
        <MultiButton isIconOnly tooltip={t('add_link')} onPress={() => addModalState.open()}>
          <PlusIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('reload')} onPress={() => list.reload()}>
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <MultiTable
        ariaLabel='user list'
        pagingList={list}
        columns={[
          { id: 'name', name: t('name'), isRowHeader: true, allowsSorting: true, minWidth: 80 },
          { id: 'url', name: t('url'), allowsSorting: true, minWidth: 120, defaultWidth: '2fr' },
          { id: 'iconPath', name: t('icon'), minWidth: 60 },
          { id: 'updatedAt', name: t('updated_at'), allowsSorting: true, minWidth: 110 },
          { id: 'action', name: t('action'), allowsSorting: false, defaultWidth: 100 },
        ]}
      >
        {(item) => (
          <Table.Row key={item.id} id={item.id}>
            <Table.Cell>{item.name}</Table.Cell>
            <Table.Cell className='font-mono text-xs'>{item.url}</Table.Cell>
            <Table.Cell>
              {item.iconPath && <Image src={item.iconPath} width={24} height={24} alt={item.name} />}
            </Table.Cell>
            <Table.Cell className='font-mono text-xs'>{dayformat(item.updatedAt, 'jp-simple')}</Table.Cell>
            <ActionCell
              items={[
                {
                  template: 'none',
                  key: 'edit',
                  icon: <PencilSquareIcon />,
                  tooltip: t('update'),
                  onPress: () => {
                    updateModalState.open(item)
                  },
                },
                {
                  template: 'delete',
                  target: item.name,
                  action: async () => {
                    await parseAction(deleteLinkWidget({ id: item.id }))
                    notify.success(t('msg_deleted_target', { target: item.name }))
                    list.reload()
                  },
                },
              ]}
            />
          </Table.Row>
        )}
      </MultiTable>

      <LinkWidgetAddModal state={addModalState} reload={list.reload} key={addModalState.key} />
      {updateModalState.target && (
        <LinkWidgetUpdateModal
          state={updateModalState}
          reload={list.reload}
          key={updateModalState.key}
          target={updateModalState.target}
        />
      )}
    </FlexCol>
  )
}

/**
 * デフォルトレイアウト編集モーダルの本体(レイアウト取得後にマウントされる)
 */
const DefaultLayoutEditBody: FC<{ initialLayout: DashboardLayout; onSaved: () => void }> = ({
  initialLayout,
  onSaved,
}) => {
  const { t } = useLocale()
  const [layout, setLayout] = useState(initialLayout)
  const [isSaving, setSaving] = useState(false)

  return (
    <>
      <Modal.Body className='bg-background rounded-2xl pt-2'>
        <DashboardLayoutEditor layout={layout} setLayout={setLayout} editable />
      </Modal.Body>
      <Modal.Footer>
        <MultiButton slot='close' variant='ghost'>
          {t('cancel')}
        </MultiButton>
        <MultiButton
          icon={<CheckIcon />}
          isPending={isSaving}
          onPress={async () => {
            setSaving(true)
            try {
              await parseAction(updateDefaultDashboard({ layout }))
              notify.success(t('msg_saved'))
              onSaved()
            } finally {
              setSaving(false)
            }
          }}
        >
          {t('save')}
        </MultiButton>
      </Modal.Footer>
    </>
  )
}

/**
 * デフォルトレイアウト編集ポップアップ
 */
const DefaultLayoutEditModal: FC<ModalBaseProps> = ({ state }) => {
  const { t } = useLocale()
  const [layout, setLayout] = useState<DashboardLayout>()

  useEffect(() => {
    parseAction(getDefaultDashboard()).then((res) => setLayout(res ?? WidgetDefaultLayout))
  }, [])

  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable={false}>
      <Modal.Container placement='top'>
        <Modal.Dialog className='max-w-3xl'>
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>
              <Squares2X2Icon />
              {t('default_layout_manage')}
            </Modal.Heading>
          </Modal.Header>
          {layout && <DefaultLayoutEditBody initialLayout={layout} onSaved={state.close} />}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

const defaultExpandedKeys = new Set(['link_widget_manage'])
export const AdminDashboardClient: FC = () => {
  const { t } = useLocale()
  const editModalState = useModalState()

  return (
    <FlexCol>
      <ContentHeader icon={<Squares2X2Icon />} title={t('dashboard_manage')} />
      <MultiButton
        size='sm'
        className='ml-4'
        variant='tertiary'
        icon={<PencilSquareIcon />}
        onPress={() => editModalState.open()}
      >
        {t('default_layout_manage')}
      </MultiButton>
      <DefaultLayoutEditModal state={editModalState} key={editModalState.key} reload={() => {}} />
      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <Accordion.Item id='link_widget_manage'>
          <Accordion.Heading>
            <Accordion.Trigger className='gap-1'>
              <PuzzlePieceIcon />
              {t('link_widget_manage')}
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            <Accordion.Body className='px-4'>
              <LinkWidgetManage />
            </Accordion.Body>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </FlexCol>
  )
}
