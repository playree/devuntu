/** MCP クライアントへ伝える対応の作法 */

import { mcpInstructions, TICKET_WORKFLOW, ticketWorkflowFor } from '@/lib/mcp/mcp-instructions'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  it('利用者の指示を最優先に、既定の手順を最下位にした優先順位を添える', () => {
    const precedence = ticketWorkflowFor('oauth', true)?.at(-1)
    expect(precedence).toMatch(
      /user instructions > the ticket > .*CLAUDE\.md.* and boardContext > boardKnowledge > boardMemory > these default steps/,
    )
  })
})

describe('mcpInstructions', () => {
  it('人の経路は手順を番号付きで含む', () => {
    const text = mcpInstructions('oauth')
    TICKET_WORKFLOW.forEach((step, i) => expect(text).toContain(`${i + 1}. ${step}`))
  })

  it('完了条件の置き場所(acceptanceCriteria)をどの経路にも伝える', () => {
    expect(mcpInstructions('oauth')).toMatch(/completion conditions .* in acceptanceCriteria/)
    expect(mcpInstructions('agent')).toMatch(/completion conditions .* in acceptanceCriteria/)
  })

  it('個人・手元の環境のことはボードノートでなくクライアント自身のメモリへ回させる', () => {
    expect(mcpInstructions('oauth')).toMatch(/own machine .*: your own memory, not board notes/)
    expect(mcpInstructions('agent')).toMatch(/own machine .*: your own memory, not board notes/)
  })

  it('人の経路は依頼されたらナレッジに書き、それ以外は提案させる。エージェントは報告で提案させる', () => {
    expect(mcpInstructions('oauth')).toContain('the user asks you to remember: knowledge (userApproved=true)')
    expect(mcpInstructions('oauth')).toContain('propose making them knowledge')
    expect(mcpInstructions('agent')).not.toContain('userApproved')
    expect(mcpInstructions('agent')).toContain('as knowledge in your report')
  })

  it('受け入れ条件の結果は report ではなく自己申告として記録させる', () => {
    expect(mcpInstructions('oauth')).toContain('report_acceptance_criteria')
    expect(mcpInstructions('agent')).not.toContain('report_acceptance_criteria')
  })

  it('既定の手順を含む優先順位は人の経路にだけ載せる(エージェントはランナーの指示に従う)', () => {
    expect(mcpInstructions('oauth')).toContain('these default steps')
    expect(mcpInstructions('agent')).not.toContain('these default steps')
  })

  it('エージェントにも、チケット > boardContext > ナレッジ > メモリの順とコメントの種別を伝える', () => {
    expect(mcpInstructions('agent')).toContain('the ticket > boardContext > boardKnowledge > boardMemory')
    expect(mcpInstructions('agent')).toContain('type=plan / type=report')
  })

  it('ドキュメントに載せた全文がコードの文言と一致する', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../docs/dev/mcp-server-internals.md', import.meta.url)),
      'utf8',
    )
    expect(doc).toContain(`\n${mcpInstructions('oauth')}\n`)
    expect(doc).toContain(`\n${mcpInstructions('agent')}\n`)
  })

  it('クライアントに切り詰められないよう短く保つ', () => {
    expect(mcpInstructions('oauth').length).toBeLessThan(2000)
  })
})
