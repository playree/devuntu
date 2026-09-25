'use client'

import { CopyableField } from '@/components/general/copyable-field'
import { GridBox } from '@/components/general/grid'
import { NoticePanel } from '@/components/general/panel'
import { TabsBox } from '@/components/general/tabs'
import { useLocale } from '@/locale/client'
import { FC, ReactNode } from 'react'

/**
 * 発行したトークンの表示。平文は発行の応答でしか受け取れないので、一度だけ見せる前提の文言を添える。
 * MCP クライアントごとの登録コマンドをタブで切り替えて出す。
 */
export const IssuedTokenView: FC<{
  token: string
  tokenLabel: string
  claudeCommand: ReactNode
  codexCommand: ReactNode
  /** タブの中身の最小高さ。切り替えでモーダルの高さが跳ねないようにする */
  panelClassName?: string
  /** 末尾に出す補足 */
  notice?: string
}> = ({ token, tokenLabel, claudeCommand, codexCommand, panelClassName, notice }) => {
  const { t } = useLocale()
  return (
    <GridBox>
      <div className='col-span-12'>
        <CopyableField text={token} label={tokenLabel} isMask />
      </div>
      <div className='col-span-12'>
        <NoticePanel className='text-xs'>{t('msg_token_once')}</NoticePanel>
      </div>
      <div className='col-span-12'>
        <TabsBox
          variant='secondary'
          aria-label={t('mcp_add_command')}
          panelClassName={panelClassName}
          items={[
            { id: 'claude', label: t('claude_code'), content: claudeCommand },
            { id: 'codex', label: t('codex_cli'), content: codexCommand },
          ]}
        />
      </div>
      {notice && (
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{notice}</NoticePanel>
        </div>
      )}
    </GridBox>
  )
}
