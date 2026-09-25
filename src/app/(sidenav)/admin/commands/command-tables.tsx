'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel, Panel } from '@/components/general/panel'
import { Cog6ToothIcon, TrashIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'
import { type CommandTargetView } from './server'

/** 準備できているかどうかだけを出す。鍵やホストのパスは画面に出さない */
const ReadyChip: FC<{ label: string; ready: boolean }> = ({ label, ready }) => {
  const { t } = useLocale()
  return (
    <Chip color={ready ? 'success' : 'danger'} variant='soft' className='whitespace-nowrap'>
      {label}: {ready ? t('ready') : t('not_ready')}
    </Chip>
  )
}

/**
 * ターゲットの一覧。
 *
 * known_hosts が読めないターゲットは StrictHostKeyChecking=yes により接続できない(fail closed)ので、
 * 実行を試す前にここで気付けるようにする。
 * アサインが 0 件のターゲットは誰も実行できないので、件数も併せて出す。
 */
export const CommandTargetTable: FC<{
  targets: CommandTargetView[]
  onManage: (target: CommandTargetView) => void
}> = ({ targets, onManage }) => {
  const { t } = useLocale()

  if (targets.length === 0) {
    return <NoticePanel>{t('command_no_def')}</NoticePanel>
  }

  return (
    <FlexCol>
      <div className='text-sm font-semibold'>{t('command_target')}</div>
      {targets.map((target) => (
        <Panel key={target.id}>
          <FlexCol>
            <FlexRow className='flex-wrap items-center'>
              <span className='font-semibold'>{target.label}</span>
              <span className='text-muted font-mono text-xs'>{target.id}</span>
              {/* 読み込めなかったファイルの一覧と突き合わせられるようにする */}
              <span className='text-muted font-mono text-xs break-all'>{target.fileName}</span>
              <span className='grow' />
              <MultiButton
                isIconOnly
                variant='outline'
                tooltip={t('settings')}
                icon={<Cog6ToothIcon />}
                onPress={() => {
                  onManage(target)
                }}
              />
            </FlexRow>
            <FlexRow className='flex-wrap items-center'>
              {/* 0 件は「誰も実行できない」を意味するので目立たせる */}
              <Chip
                color={target.memberCount + target.groupCount > 0 ? 'default' : 'warning'}
                variant='soft'
                className='whitespace-nowrap'
              >
                {t('command_target_assign')}: {target.memberCount} / {target.groupCount}
              </Chip>
              <ReadyChip label={t('command_target_identity')} ready={target.identityReady} />
              <ReadyChip label={t('command_target_known_hosts')} ready={target.knownHostsReady} />
            </FlexRow>
          </FlexCol>
        </Panel>
      ))}
    </FlexCol>
  )
}

/**
 * 定義から消えたターゲットに残っているアサイン。
 *
 * このアサインは権限を与えない(判定はカタログに載っているキーだけを見る)。
 * それでも見せるのは、同じ ID でターゲットを作り直したときに昔のアサインが復活するため。
 */
export const OrphanTargetTable: FC<{
  orphans: { targetKey: string; memberCount: number; groupCount: number }[]
  unknown: boolean
  onPurge: (targetKey: string) => void
}> = ({ orphans, unknown, onPurge }) => {
  const { t } = useLocale()

  if (unknown) {
    return <NoticePanel status='warning'>{t('command_target_orphan_unknown')}</NoticePanel>
  }
  if (orphans.length === 0) {
    return null
  }

  return (
    <NoticePanel status='warning' title={t('command_target_orphan')}>
      <FlexCol>
        <div className='text-xs'>{t('command_target_orphan_description')}</div>
        {orphans.map((orphan) => (
          <FlexRow key={orphan.targetKey} className='flex-wrap items-center'>
            <span className='font-mono text-xs break-all'>{orphan.targetKey}</span>
            <span className='grow' />
            <Chip variant='soft' className='whitespace-nowrap'>
              {t('command_target_assign')}: {orphan.memberCount} / {orphan.groupCount}
            </Chip>
            <MultiButton
              isIconOnly
              variant='danger-soft'
              tooltip={t('command_target_purge')}
              icon={<TrashIcon />}
              onPress={() => {
                onPurge(orphan.targetKey)
              }}
            />
          </FlexRow>
        ))}
      </FlexCol>
    </NoticePanel>
  )
}
