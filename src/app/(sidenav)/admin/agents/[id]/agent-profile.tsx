'use client'

import { MultiButton } from '@/components/general/button'
import { CopyableField } from '@/components/general/copyable-field'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { NoticePanel } from '@/components/general/panel'
import { MultiSelectCtrl } from '@/components/general/select'
import { CheckIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { dayformat } from '@/lib/day'
import { scUpdateAgent, UpdateAgent } from '@/lib/schema'
import { useUserTimezone } from '@/lib/use-timezone'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { FC, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { GetAgentReturnType, updateAgent } from '../server'

type Agent = NonNullable<GetAgentReturnType>

/** 見出し + 値の 1 行 */
const MetaRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-baseline gap-2'>
    <span className='w-24 shrink-0 text-xs text-gray-500'>{label}</span>
    <div className='min-w-0 text-sm'>{children}</div>
  </div>
)

/** エージェントの概要 + 編集フォーム。識別子(メール)は保存済みメンションが解決できなくなるため編集させない */
export const AgentProfile: FC<{ agent: Agent; groupOptions: Record<string, string>; reload: () => void }> = ({
  agent,
  groupOptions,
  reload,
}) => {
  const { t, fet } = useLocale()
  const tz = useUserTimezone()

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = useForm<UpdateAgent>({
    resolver: zodResolver(scUpdateAgent),
    mode: 'onChange',
    defaultValues: {
      id: agent.id,
      name: agent.name,
      groups: agent.groups.map((group) => group.id),
    },
  })

  return (
    <form
      onSubmit={handleSubmit(async (req) => {
        await parseAction(updateAgent(req))
        notify.success(t('msg_saved'))
        reset(req)
        reload()
      })}
    >
      <GridBox isSmart>
        <div className='col-span-12'>
          <MetaRow label={t('created_at')}>
            <span className='font-mono text-xs'>{dayformat(agent.createdAt, 'tz-simple', tz)}</span>
          </MetaRow>
        </div>
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='name'
            constraintSchema={scUpdateAgent}
            label={t('name')}
            errorMessage={fet(errors.name)}
          />
        </div>
        <div className='col-span-12'>
          <CopyableField text={agent.email} label={t('email')} copyLabel={t('copy')} />
        </div>
        <div className='col-span-12'>
          <NoticePanel className='text-xs'>{t('msg_agent_email_desc')}</NoticePanel>
        </div>
        <div className='col-span-12'>
          <MultiSelectCtrl control={control} name='groups' groupOptions={groupOptions} label={t('group')} />
        </div>
        <div className='col-span-12 flex items-center gap-2'>
          <MultiButton className='ml-auto' type='submit' size='sm' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('save')}
          </MultiButton>
        </div>
      </GridBox>
    </form>
  )
}
