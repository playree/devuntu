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

/** GitHub / GitLab 側で Webhook を登録する手順。改行区切りの文言を番号付きの手順にする */
export const WebhookSteps: FC<{ steps: string }> = ({ steps }) => {
  const { t } = useLocale()
  return (
    <FlexCol isSmart>
      <span className='text-sm'>{t('git_webhook_steps')}</span>
      <ol className='text-foreground list-decimal space-y-1 pl-5 text-sm'>
        {steps.split('\n').map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </FlexCol>
  )
}

export const IssuedTokenModal: FC<{
  state: ReturnType<typeof useModalState<IssuedTarget>>
  /** モーダルのタイトルと、シークレットの欄の名前 */
  label: string
  /** Webhook の登録手順(改行区切り) */
  steps: string
  description?: string
}> = ({ state, label, steps, description }) => {
  const { t } = useLocale()
  const target = state.target
  return (
    <DialogModal
      state={state}
      size='3xl'
      title={{ text: label, icon: <KeyIcon /> }}
      footer={<MultiButton onPress={state.close}>{t('ok')}</MultiButton>}
    >
      {target && (
        <FlexCol isSmart>
          <span className='font-mono text-sm break-all'>{target.repo}</span>
          <CopyableField label={t('git_webhook_url')} text={target.webhookUrl} />
          <CopyableField label={label} text={target.token} isMask />
          <NoticePanel status='warning' className='text-xs' title={t('msg_token_once')}>
            {description}
          </NoticePanel>
          <WebhookSteps steps={steps} />
        </FlexCol>
      )}
    </DialogModal>
  )
}
