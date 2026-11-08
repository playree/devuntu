'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { RadioCtrl } from '@/components/general/radio'
import { ArchiveBoxIcon, CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiVisibilityOptions } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { scUpdateWikiSpace, type UpdateWikiSpace } from '@/lib/schema/schema-wiki'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { type WikiSpaceContextValue } from '../space-context'
import { setWikiSpaceArchived, updateWikiSpace } from './server'

type Space = WikiSpaceContextValue['space']

/** 名前・説明・公開範囲。キーは変えられないので表示だけにする */
export const WikiSpaceProfile: FC<{ space: Space; reload: () => Promise<void> }> = ({ space, reload }) => {
  const { t, fet } = useLocale()
  const visibilityOptions = useWikiVisibilityOptions()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<UpdateWikiSpace>({
    resolver: zodResolver(scUpdateWikiSpace),
    mode: 'onChange',
    defaultValues: {
      id: space.id,
      name: space.name,
      description: space.description ?? '',
      visibility: space.visibility,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        try {
          await parseAction(updateWikiSpace(req))
          notify.success(t('msg_saved'))
          // 再取得しても useForm の defaultValues は追従しないので、保存値で dirty を落としておく
          reset(req)
          await reload()
        } catch (e) {
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <p className='text-muted text-xs'>{t('wiki_space_key')}</p>
          <p className='font-mono text-sm'>{space.key}</p>
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scUpdateWikiSpace}
            label={t('name')}
            errorMessage={fet(errors.name)}
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='description'
            constraintSchema={scUpdateWikiSpace}
            label={t('description')}
            errorMessage={fet(errors.description)}
          />
        </div>
        <div className='col-span-12'>
          <RadioCtrl
            control={control}
            name='visibility'
            label={t('wiki_visibility')}
            options={Object.entries(visibilityOptions).map(([value, label]) => ({ value, label }))}
          />
          <p className='text-muted text-xs'>{t('msg_wiki_visibility')}</p>
        </div>
        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}

/** アーカイブの切り替え。アーカイブ中は閲覧のみになるが、設定は変えられるので解除もここで行う */
export const WikiSpaceArchive: FC<{ space: Space; reload: () => Promise<void> }> = ({ space, reload }) => {
  const { t } = useLocale()
  const confirmAction = useConfirmAction()

  const toggleArchive = async () => {
    const next = !space.archived
    await confirmAction(
      {
        title: t('confirm_archive'),
        text: next
          ? t('msg_confirm_archive_wiki_space', { target: space.name })
          : t('msg_confirm_unarchive_wiki_space', { target: space.name }),
      },
      async () => {
        await parseAction(setWikiSpaceArchived({ id: space.id, archived: next }))
        notify.success(t('msg_saved'))
        await reload()
      },
    )
  }

  return (
    <div className='flex flex-wrap items-center gap-2 py-3'>
      <div className='min-w-0 flex-1'>
        <div className='text-sm font-semibold'>{t('archived')}</div>
        <div className='text-muted text-xs'>{t('msg_archive_wiki_space')}</div>
      </div>
      <MultiButton size='sm' variant='danger-soft' icon={<ArchiveBoxIcon />} onPress={toggleArchive}>
        {space.archived ? t('unarchive') : t('archive')}
      </MultiButton>
    </div>
  )
}
