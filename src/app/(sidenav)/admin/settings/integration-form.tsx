'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { MultiSelectCtrl } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { scUpdateIntegrationSettings, UpdateIntegrationSettings } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'

type SaveAction = (req: UpdateIntegrationSettings) => Promise<{
  data?: unknown
  serverError?: { name?: string; errorType: string }
  validationErrors?: unknown
}>

/**
 * 外部サービス連携の設定フォーム(有効化 + 利用を許可するグループ)。
 *
 * 連携ごとに異なるのは文言と保存先アクションだけなので、そこだけを props で受ける。
 * 設定取得後にマウントされる前提で、初期値は `initial` から入れる。
 */
export const IntegrationSettingsForm: FC<{
  initial: UpdateIntegrationSettings
  groupOptions: Record<string, string>
  /** SwitchCtrl の id。1 画面に複数の連携が並ぶため連携ごとに一意にする */
  id: string
  enableLabel: string
  enableDescription: string
  groupsLabel: string
  groupsDescription: string
  onSave: SaveAction
}> = ({ initial, groupOptions, id, enableLabel, enableDescription, groupsLabel, groupsDescription, onSave }) => {
  const { t } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<UpdateIntegrationSettings>({
    resolver: zodResolver(scUpdateIntegrationSettings),
    mode: 'onChange',
    defaultValues: initial,
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(onSave(req))
        notify.success(t('msg_saved'))
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12 pb-2'>
          <SwitchCtrl control={control} name='enabled' id={id} label={enableLabel} />
          <p className='mt-1 text-sm text-neutral-500'>{enableDescription}</p>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='allowedGroupIds' groupOptions={groupOptions} label={groupsLabel} />
          <p className='mt-1 text-sm text-neutral-500'>{groupsDescription}</p>
        </div>
        <div className='col-span-12 pt-2'>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}
