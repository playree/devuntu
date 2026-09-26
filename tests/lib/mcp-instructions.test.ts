/** MCP クライアントへ伝える対応の作法 */

import { mcpInstructions, TICKET_WORKFLOW, ticketWorkflowFor } from '@/lib/mcp/mcp-instructions'
import { describe, expect, it } from 'vitest'

describe('ticketWorkflowFor', () => {
  it('人の経路でチケットを編集できるときだけ手順を返す', () => {
    expect(ticketWorkflowFor('oauth', true)).toEqual(expect.arrayContaining([...TICKET_WORKFLOW]))
    expect(ticketWorkflowFor('pat', true)).toBeDefined()
  })

  it('編集できない人には、実行できない手順になるので返さない', () => {
    expect(ticketWorkflowFor('oauth', false)).toBeUndefined()
  })

  it('エージェントはランナーの指示に従うので返さない', () => {
    expect(ticketWorkflowFor('agent', true)).toBeUndefined()
  })

  it('利用者の指示が優先であることを添える', () => {
    expect(ticketWorkflowFor('oauth', true)?.at(-1)).toContain('利用者の指示')
  })
})

describe('mcpInstructions', () => {
  it('人の経路は手順を番号付きで含む', () => {
    const text = mcpInstructions('oauth')
    TICKET_WORKFLOW.forEach((step, i) => expect(text).toContain(`${i + 1}. ${step}`))
  })

  it('クライアントに切り詰められないよう短く保つ', () => {
    expect(mcpInstructions('oauth').length).toBeLessThan(2000)
  })
})
