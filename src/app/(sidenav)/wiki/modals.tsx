'use client'

import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { RadioCtrl } from '@/components/general/radio'
import { PlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiVisibilityOptions } from '@/components/wiki-chip'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { type CreateWikiSpace, scCreateWikiSpace } from '@/lib/schema/schema-wiki'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { createWikiSpace } from './server'

/** スペースの作成。作ったらそのスペースのトップへ移る */
export const AddSpaceModal: FC<ModalBaseProps> = ({ state, reload }) => {
  const { t, fet } = useLocale()
  const router = useRouter()
  const visibilityOptions = useWikiVisibilityOptions()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateWikiSpace>({
    resolver: zodResolver(scCreateWikiSpace),
    mode: 'onChange',
    defaultValues: { name: '', key: '', description: '', visibility: 'restricted' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createWikiSpace(req))
          notify.success(t('msg_added_target', { target: res.name }))
          reload()
          state.close()
          router.push(`/wiki/${res.key}`)
        } catch (e) {
          // キーの重複などは parseAction が通知済み。入力し直してもらうため画面はそのまま残す
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
      title={{ text: t('wiki_add_space'), icon: <PlusIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scCreateWikiSpace}
            label={t('name')}
            errorMessage={fet(errors.name)}
            autoFocus
          />
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='key'
            constraintSchema={scCreateWikiSpace}
            label={t('wiki_space_key')}
            placeholder='DOCS'
            errorMessage={fet(errors.key)}
            // 入力は小文字でも zWikiSpaceKey が大文字へ寄せるので、見た目も大文字に揃えておく
            className='font-mono uppercase'
          />
          <p className='text-muted text-xs'>{t('msg_wiki_space_key')}</p>
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='description'
            constraintSchema={scCreateWikiSpace}
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
      </GridBox>
    </FormModal>
  )
}
