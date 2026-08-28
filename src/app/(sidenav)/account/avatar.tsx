'use client'

import { FileInputCtrl } from '@/components/file-input-ctrl'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { scSetUserAvatar, SetUserAvatar } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useState } from 'react'
import { useForm } from 'react-hook-form'
import { setUserAvatar } from './server'

export const AvatarSetting: FC = () => {
  const { t, fet } = useLocale()
  const { data: session } = authClient.useSession()
  // 保存直後にセッションの再取得を待たずプレビューへ反映するためのローカル状態
  const [avatarUrl, setAvatarUrl] = useState(session?.user.image)
  // セッション側の image が外部要因で変わったら追従する(レンダー中に検知して同期)
  const [syncedImage, setSyncedImage] = useState(session?.user.image)
  if (session?.user.image !== syncedImage) {
    setSyncedImage(session?.user.image)
    setAvatarUrl(session?.user.image)
  }

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
          const { image } = await parseAction(setUserAvatar(req))
          setAvatarUrl(image)
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
          existingUrl={avatarUrl}
        />
        <MultiButton type='submit' isPending={isSubmitting} isDisabled={!isDirty}>
          {t('save')}
        </MultiButton>
      </form>
    </FlexCol>
  )
}
