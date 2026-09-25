'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowLeftCircleIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'

/**
 * 対象を取得できなかった(権限が無い・存在しない)ときの画面。
 * useActionData は ClientError を通知しないため、詳細画面で取得結果が空のときに出す。
 */
export const NoAccessView: FC<{ icon?: ReactNode; title: ReactNode; backHref?: string }> = ({
  icon,
  title,
  backHref,
}) => {
  const { t } = useLocale()
  const router = useRouter()
  return (
    <FlexCol>
      <ContentHeader icon={icon} title={title}>
        {backHref && (
          <MultiButton
            isIconOnly
            tooltip={t('back')}
            icon={<ArrowLeftCircleIcon />}
            onPress={() => router.push(backHref)}
          />
        )}
      </ContentHeader>
      <NoticePanel>{t('msg_no_access')}</NoticePanel>
    </FlexCol>
  )
}
