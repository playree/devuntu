'use client'

import { FileInputCtrl } from '@/components/file-input-ctrl'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { scSetUserAvatar, SetUserAvatar } from '@/lib/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC } from 'react'
import { useForm } from 'react-hook-form'
import { setUserAvatar } from './server'

export const AvatarSetting: FC = () => {
  const { t, fet } = useLocale()
  const { data: session } = authClient.useSession()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, isDirty, errors },
  } = useForm<SetUserAvatar>({
    resolver: zodResolver(scSetUserAvatar),
    mode: 'onChange',
    defaultValues: { image: undefined },
  })

  return (
    <FlexCol>
      <p className='text-default-500 max-w-sm px-1 text-sm'>{t('msg_avatar_desc')}</p>
      <form
        className='flex items-end gap-3 px-1'
        onSubmit={handleSubmit(async (req) => {
          await parseAction(setUserAvatar(req))
          notify.success(t('msg_saved'))
          reset({ image: undefined })
        })}
      >
        <FileInputCtrl // 見出しは AccordionSection 側で出しているのでラベルは読み上げ用にだけ残す
          control={control}
          variant='outline'
          name='image'
          label={t('avatar')}
          errorMessage={fet(errors.image)}
          existingUrl={session?.user.image}
        />
        <MultiButton type='submit' isPending={isSubmitting} isDisabled={!isDirty}>
          {t('save')}
        </MultiButton>
      </form>
    </FlexCol>
  )
}
