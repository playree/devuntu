'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { FlexCol } from '@/components/general/flex'
import { DialogModal, useModalState } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { KeyIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { FC } from 'react'

/** Webhook の登録先。トークンの入力 / 表示のモーダルで一緒に見せる */
export type WebhookTarget = { id: string; repo: string; webhookUrl: string }

/** 作ったシークレットの表示。平文は作った応答でしか受け取れないので一度だけ見せる */
export type IssuedTarget = WebhookTarget & { token: string }

export const IssuedTokenModal: FC<{
  state: ReturnType<typeof useModalState<IssuedTarget>>
  /** モーダルのタイトルと、シークレットの欄の名前 */
  label: string
  description: string
}> = ({ state, label, description }) => {
  const { t } = useLocale()
  const target = state.target
  return (
    <DialogModal
      state={state}
      title={{ text: label, icon: <KeyIcon /> }}
      footer={<MultiButton onPress={state.close}>{t('ok')}</MultiButton>}
    >
      {target && (
        <FlexCol>
          <span className='font-mono text-sm break-all'>{target.repo}</span>
          <CopyableField label={t('git_webhook_url')} text={target.webhookUrl} />
          <CopyableField label={label} text={target.token} isMask />
          <NoticePanel className='text-xs'>
            {t('msg_token_once')}
            {'\n'}
            {description}
          </NoticePanel>
        </FlexCol>
      )}
    </DialogModal>
  )
}
