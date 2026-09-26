'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { ArrowPathIcon, CommandLineIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { dayformat } from '@/lib/day'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { CommandTargetTable, OrphanTargetTable } from './command-tables'
import {
  getCommandTargets,
  type GetCommandTargetsReturnType,
  purgeOrphanCommandAssigns,
  reloadCommandDefs,
} from './server'

/**
 * リモート管理
 *
 * ターゲットの定義そのものはサーバー上の YAML が持つ。この画面で扱うのは
 * ターゲットへのアサインだけで、接続先もコマンドも画面からは作れない。
 * コマンド定義の編集はターゲットのオーナーが `/commands/targets/[targetId]` で行う。
 */
export const AdminCommandsClient: FC = () => {
  const { t } = useLocale()
  const tz = useUserTimezone()
  const router = useRouter()
  const { data, isLoading, refresh } = useActionData(getCommandTargets)
  const confirmAction = useConfirmAction()

  const purge = (targetKey: string) =>
    confirmAction(
      { title: t('command_target_purge'), text: t('msg_confirm_deletion', { target: targetKey }) },
      async () => {
        await parseAction(purgeOrphanCommandAssigns({ targetKey }))
        notify.success(t('msg_deleted_target', { target: targetKey }))
        await refresh()
      },
    )

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_manage')}>
        <MultiButton
          isIconOnly
          tooltip={t('command_def_reload')}
          coolTime={3}
          icon={<ArrowPathIcon />}
          onPress={async () => {
            // 押したプロセスに即時反映させ、表示はいつもの取得経路で描き直す
            await parseAction(reloadCommandDefs())
            await refresh()
          }}
        />
      </ContentHeader>

      {isLoading && !data ? (
        <PanelSkeleton />
      ) : (
        <CommandTargetsBody
          data={data}
          tz={tz}
          onManage={(targetKey) => router.push(`/admin/commands/${targetKey}`)}
          onPurge={purge}
        />
      )}
    </FlexCol>
  )
}

const CommandTargetsBody: FC<{
  data: GetCommandTargetsReturnType
  tz: string
  onManage: (targetKey: string) => void
  onPurge: (targetKey: string) => void
}> = ({ data, tz, onManage, onPurge }) => {
  const { t } = useLocale()

  if (!data) {
    return <NoticePanel status='danger'>{t('error')}</NoticePanel>
  }

  return (
    <FlexCol>
      {!data.enabled && <NoticePanel status='warning'>{t('command_disabled')}</NoticePanel>}

      <div className='text-muted text-xs'>
        <div>
          {t('command_def_dir')}: <span className='font-mono break-all'>{data.dir}</span>
        </div>
        <div>
          {t('command_def_loaded', { loaded: data.targets.length, excluded: data.issues.length })}
          {' / '}
          {dayformat(data.loadedAt, 'tz-minute', tz)}
        </div>
      </div>

      {data.issues.length > 0 && (
        <NoticePanel // 読み込めなかったファイルがあっても、読み込めた分は使えるので一覧は常に出す
          status='danger'
          title={t('command_invalid_def')}
        >
          <FlexCol className='gap-1'>
            {data.issues.map((issue) => (
              <div key={issue.fileName ?? ''}>
                <span className='font-mono font-semibold break-all'>{issue.fileName ?? t('command_def_dir')}</span>
                <ul className='list-disc pl-5'>
                  {issue.messages.map((message) => (
                    <li key={message} className='break-all'>
                      {message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </FlexCol>
        </NoticePanel>
      )}

      <CommandTargetTable targets={data.targets} onManage={(target) => onManage(target.id)} />
      <OrphanTargetTable orphans={data.orphans} unknown={data.orphanUnknown} onPurge={onPurge} />
    </FlexCol>
  )
}
