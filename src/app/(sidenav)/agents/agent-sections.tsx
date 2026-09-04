'use client'

import { AgentCustomInstruction } from '@/components/agent/agent-custom-instruction'
import { AgentRunHistory } from '@/components/agent/agent-run-history'
import { AgentRunner } from '@/components/agent/agent-runner'
import { AccordionSection } from '@/components/general/accordion'
import { usePagingList } from '@/components/general/paging'
import { ClipboardDocumentIcon, ClockIcon, RocketLaunchIcon } from '@/components/icon'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { ComponentProps, FC } from 'react'
import { getAgentRunner, getAgentRuns, saveAgentRunner, saveAgentRunnerRule } from './server'

/** 開閉状態はエージェントの切り替え(= リマウント)を跨いで保つため、呼び出し側の state で持つ */
export type AgentSectionKeys = NonNullable<ComponentProps<typeof Accordion>['expandedKeys']>

/**
 * 承認画面から触れるエージェントの設定セクション(エージェント管理と同じ内容)。
 *
 * `useActionData` は参照している値が変わっても再取得しないため、対象エージェントの切り替えは
 * 呼び出し側の `key` によるリマウントで行う。ここでは `agentId` を props から読むだけにする。
 */
export const AgentSections: FC<{
  agentId: string
  expandedKeys: AgentSectionKeys
  onExpandedChange: (keys: Set<string | number>) => void
}> = ({ agentId, expandedKeys, onExpandedChange }) => {
  const { t } = useLocale()

  const {
    data: runner,
    refresh: refreshRunner,
    isLoading: isRunnerLoading,
  } = useActionData(() => getAgentRunner({ id: agentId }))
  const runHistoryList = usePagingList({
    load: async () => (await parseAction(getAgentRuns({ id: agentId }))) ?? [],
    sort: { init: { column: 'startedAt', direction: 'descending' } },
  })

  return (
    <Accordion allowsMultipleExpanded expandedKeys={expandedKeys} onExpandedChange={onExpandedChange}>
      <AccordionSection id='agent_runner' icon={<RocketLaunchIcon />} title={t('agent_runner')}>
        <AgentRunner
          agentId={agentId}
          current={runner}
          isLoading={isRunnerLoading}
          refresh={refreshRunner}
          save={saveAgentRunner}
        />
      </AccordionSection>

      <AccordionSection
        id='agent_custom_instruction'
        icon={<ClipboardDocumentIcon />}
        title={t('agent_custom_instruction')}
      >
        <AgentCustomInstruction
          agentId={agentId}
          current={runner}
          isLoading={isRunnerLoading}
          refresh={refreshRunner}
          saveRule={saveAgentRunnerRule}
        />
      </AccordionSection>

      <AccordionSection // 履歴表は行数が多く、Popover を含むので開くまで作らない
        isLazyBody
        id='agent_run_history'
        icon={<ClockIcon />}
        title={t('agent_run_history')}
      >
        <AgentRunHistory pagingList={runHistoryList} />
      </AccordionSection>
    </Accordion>
  )
}
