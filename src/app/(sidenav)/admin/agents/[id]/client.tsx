'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ClockIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  KeyIcon,
} from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { getGroupOptions } from '../server'
import { AgentProfile } from './agent-profile'
import { AgentRunHistory } from './agent-run-history'
import { AgentRunner } from './agent-runner'
import { AgentToken } from './agent-token'
import { DangerZone } from './danger-zone'
import { getAgent, getAgentRunner, getAgentRuns, getAgentToken } from './server'

/** デンジャーゾーンは誤操作を避けるため初期状態で閉じておく */
const defaultExpandedKeys = new Set(['agent_profile', 'agent_runner', 'agent_run_history', 'agent_token'])

export const AdminAgentDetailClient: FC<{ agentId: string; baseUrl: string }> = ({ agentId, baseUrl }) => {
  const { t } = useLocale()
  const router = useRouter()

  const { data: agent, reload, isLoading } = useActionData(() => getAgent({ id: agentId }))
  const {
    data: runner,
    reload: reloadRunner,
    isLoading: isRunnerLoading,
  } = useActionData(() => getAgentRunner({ id: agentId }))
  const {
    data: token,
    reload: reloadToken,
    isLoading: isTokenLoading,
  } = useActionData(() => getAgentToken({ id: agentId }))
  const { data: groupOptions } = useActionData(getGroupOptions)
  const runHistoryList = usePagingList({
    load: async () => (await parseAction(getAgentRuns({ id: agentId }))) ?? [],
    sort: { init: { column: 'startedAt', direction: 'descending' } },
  })

  if (isLoading) {
    return <PanelSkeleton />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!agent) {
    return (
      <FlexCol>
        <ContentHeader icon={<Cog6ToothIcon />} title={t('agent_settings')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/admin/agents')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
  }

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={agent.name}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/admin/agents')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('reload')}
          onPress={() => {
            reload()
            reloadRunner()
            reloadToken()
            runHistoryList.reload()
          }}
        >
          <ButtonGroup.Separator />
          <ArrowPathIcon />
        </MultiButton>
      </ContentHeader>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='agent_profile' icon={<InformationCircleIcon />} title={t('agent_profile')}>
          <AgentProfile agent={agent} groupOptions={groupOptions ?? {}} reload={reload} />
        </AccordionSection>

        <AccordionSection id='agent_runner' icon={<Cog6ToothIcon />} title={t('agent_runner')}>
          <AgentRunner agentId={agentId} current={runner} isLoading={isRunnerLoading} reload={reloadRunner} />
        </AccordionSection>

        <AccordionSection id='agent_run_history' icon={<ClockIcon />} title={t('agent_run_history')}>
          <AgentRunHistory pagingList={runHistoryList} />
        </AccordionSection>

        <AccordionSection id='agent_token' icon={<KeyIcon />} title={t('agent_token')}>
          <AgentToken
            agentId={agentId}
            baseUrl={baseUrl}
            current={token}
            isLoading={isTokenLoading}
            reload={reloadToken}
          />
        </AccordionSection>

        <AccordionSection
          id='danger_zone'
          icon={<ExclamationTriangleIcon className='text-danger' />}
          title={t('danger_zone')}
        >
          <DangerZone agent={agent} />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
