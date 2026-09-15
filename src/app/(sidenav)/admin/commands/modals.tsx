'use client'

import { MultiButton } from '@/components/general/button'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { MultiSelectCtrl } from '@/components/general/select'
import { SwitchCtrl } from '@/components/general/switch'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { scUpdateCommandSetting, type UpdateCommandSetting } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { type CommandDefView, updateCommandSettingAction } from './server'

/**
 * コマンドごとの実行設定。
 *
 * 編集できるのは有効化・許可グループ・表示順だけで、実行先や引数は定義ファイル側の関心事。
 */
export const SettingModal: FC<ModalBaseProps & { target: CommandDefView; groupOptions: Record<string, string> }> = ({
  state,
  reload,
  target,
  groupOptions,
}) => {
  const { t, fet } = useLocale()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<UpdateCommandSetting>({
    resolver: zodResolver(scUpdateCommandSetting),
    mode: 'onChange',
    defaultValues: {
      commandKey: target.id,
      enabled: target.setting.enabled,
      sortOrder: target.setting.sortOrder,
      allowedGroupIds: target.setting.allowedGroupIds,
    },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateCommandSettingAction(req))
        notify.success(t('msg_saved'))
        reload()
        state.close()
      })}
      title={{ text: target.label, icon: <PencilSquareIcon /> }}
      footer={
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
        <div className='col-span-12 pb-2'>
          <SwitchCtrl control={control} name='enabled' id={`command-enabled-${target.id}`} label={t('enabled')} />
          <p className='mt-1 text-sm text-neutral-500'>{t('command_enabled_description')}</p>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl
            control={control}
            name='allowedGroupIds'
            groupOptions={groupOptions}
            label={t('command_allowed_groups')}
          />
          <p className='mt-1 text-sm text-neutral-500'>{t('command_allowed_groups_description')}</p>
        </div>
        <div className='col-span-12 md:col-span-4'>
          <InputCtrl
            control={control}
            name='sortOrder'
            type='number'
            constraintSchema={scUpdateCommandSetting}
            label={t('sort_order')}
            errorMessage={fet(errors.sortOrder)}
          />
        </div>
      </GridBox>
    </FormModal>
  )
}
