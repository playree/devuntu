'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { RadioCtrl } from '@/components/general/radio'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiSpaceTypeOptions, useWikiVisibilityOptions } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { scUpdateWikiSpace, type UpdateWikiSpace } from '@/lib/schema/schema-wiki'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { type WikiSpaceContextValue } from '../space-context'
import { updateWikiSpace } from './server'

type Space = WikiSpaceContextValue['space']

/** 名前・説明・公開範囲・区分。キーは変えられないので表示だけにする */
export const WikiSpaceProfile: FC<{ space: Space; reload: () => Promise<void> }> = ({ space, reload }) => {
  const { t, fet } = useLocale()
  const visibilityOptions = useWikiVisibilityOptions()
  const spaceTypeOptions = useWikiSpaceTypeOptions()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<UpdateWikiSpace>({
    resolver: zodResolver(scUpdateWikiSpace),
    mode: 'onChange',
    defaultValues: {
      id: space.id,
      name: space.name,
      description: space.description ?? '',
      visibility: space.visibility,
      type: space.type,
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
        <div className='col-span-6'>
          <RadioCtrl
            control={control}
            name='visibility'
            label={t('wiki_visibility')}
            help={t('msg_wiki_visibility')}
            options={Object.entries(visibilityOptions).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <div className='col-span-6'>
          <RadioCtrl
            control={control}
            name='type'
            label={t('wiki_space_type')}
            help={t('msg_wiki_space_type')}
            options={Object.entries(spaceTypeOptions).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton
            className='ml-auto'
            type='submit'
            size='sm'
            icon={<CheckIcon />}
            isPending={isSubmitting}
            isDisabled={!isDirty}
          >
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}
