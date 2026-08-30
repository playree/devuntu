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
  RocketLaunchIcon,
  ShieldCheckIcon,
} from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { getApproverUserOptions, getGroupOptions } from '../server'
import { AgentApprover } from './agent-approver'
import { AgentProfile } from './agent-profile'
import { AgentRunHistory } from './agent-run-history'
import { AgentRunner } from './agent-runner'
import { AgentToken } from './agent-token'
import { DangerZone } from './danger-zone'
import { getAgent, getAgentApprovers, getAgentRunner, getAgentRuns, getAgentToken } from './server'

/** デンジャーゾーンは誤操作を避けるため初期状態で閉じておく */
const defaultExpandedKeys = new Set(['agent_profile'])

export const AdminAgentDetailClient: FC<{ agentId: string; baseUrl: string }> = ({ agentId, baseUrl }) => {
  const { t } = useLocale()
  const router = useRouter()

  const { data: agent, reload, refresh, isLoading } = useActionData(() => getAgent({ id: agentId }))
  const {
    data: runner,
    reload: reloadRunner,
    refresh: refreshRunner,
    isLoading: isRunnerLoading,
  } = useActionData(() => getAgentRunner({ id: agentId }))
  const {
    data: token,
    reload: reloadToken,
    refresh: refreshToken,
    isLoading: isTokenLoading,
  } = useActionData(() => getAgentToken({ id: agentId }))
  const {
    data: approvers,
    reload: reloadApprovers,
    refresh: refreshApprovers,
    isLoading: isApproversLoading,
  } = useActionData(() => getAgentApprovers({ id: agentId }))
  const { data: groupOptions } = useActionData(getGroupOptions)
  const { data: approverUserOptions } = useActionData(getApproverUserOptions)
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
            reloadApprovers()
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
          <AgentProfile agent={agent} groupOptions={groupOptions ?? {}} refresh={refresh} />
        </AccordionSection>

        <AccordionSection id='agent_approver' icon={<ShieldCheckIcon />} title={t('agent_approver')}>
          {isApproversLoading ? (
            <PanelSkeleton />
          ) : (
            <AgentApprover
              agentId={agentId}
              current={approvers}
              userOptions={approverUserOptions ?? []}
              groupOptions={groupOptions ?? {}}
              refresh={refreshApprovers}
            />
          )}
        </AccordionSection>

        <AccordionSection id='agent_runner' icon={<RocketLaunchIcon />} title={t('agent_runner')}>
          <AgentRunner agentId={agentId} current={runner} isLoading={isRunnerLoading} refresh={refreshRunner} />
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
            refresh={refreshToken}
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
