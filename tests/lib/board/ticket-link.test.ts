/** チケットへのリンク登録(同じものの同時登録) */

import { assertTicketAccess } from '@/lib/board/board-access'
import { addTicketLink, listTicketLinks } from '@/lib/board/ticket-link'
import { prisma } from '@/lib/prisma'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  ticketLink: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
}

vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma())

vi.mock('@/lib/board/board-access', () => ({
  assertTicketAccess: vi.fn(async () => ({})),
}))

const actor = { id: 'u1' }
const URL = 'https://github.com/owner/repo/pull/12'
const KEY = { ticketId: 't1', provider: 'github', baseUrl: '', repo: 'owner/repo', kind: 'pull_request', ref: '12' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (t: typeof tx) => unknown) => fn(tx)) as never)
  tx.ticketLink.findUnique.mockResolvedValue(null)
  tx.ticketLink.count.mockResolvedValue(0)
  tx.ticketLink.create.mockResolvedValue({ id: 'l1' })
  tx.ticketLink.update.mockResolvedValue({ id: 'l1' })
})

describe('addTicketLink', () => {
  it('無ければ作る', async () => {
    await expect(addTicketLink(actor, 't1', URL)).resolves.toEqual({ id: 'l1' })
    expect(tx.ticketLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ...KEY, source: 'manual', createdById: 'u1' }) }),
    )
  })

  it('同時の登録に先を越されたら、権限を確かめ直して既存の行を表示に戻す', async () => {
    tx.ticketLink.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(addTicketLink(actor, 't1', URL)).resolves.toEqual({ id: 'l1' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(assertTicketAccess).toHaveBeenCalledTimes(2)
    expect(tx.ticketLink.update).toHaveBeenCalledWith({
      where: { ticketId_provider_baseUrl_repo_kind_ref: KEY },
      data: { dismissed: false },
      select: { id: true },
    })
  })

  describe('GitLab', () => {
    const MR_URL = 'https://example.com/gitlab/Group/Proj/-/merge_requests/3'

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('GITLAB_URLS に含まれるインスタンスの URL は gitlab として登録する', async () => {
      vi.stubEnv('GITLAB_URLS', 'https://gitlab.com, https://example.com/gitlab/')

      await addTicketLink(actor, 't1', MR_URL)
      expect(tx.ticketLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: 't1',
            provider: 'gitlab',
            baseUrl: 'https://example.com/gitlab',
            repo: 'group/proj',
            kind: 'pull_request',
            ref: '3',
            url: 'https://example.com/gitlab/group/proj/-/merge_requests/3',
          }),
        }),
      )
    })

    it('GITLAB_URLS が読めなくても、GitHub の URL は登録できる', async () => {
      vi.stubEnv('GITLAB_URLS', 'https://gitlab.com,gitlab.internal')

      await expect(addTicketLink(actor, 't1', URL)).resolves.toEqual({ id: 'l1' })
    })

    it('許可していないインスタンスの URL は受け付けない', async () => {
      vi.stubEnv('GITLAB_URLS', 'https://gitlab.com')

      await expect(addTicketLink(actor, 't1', MR_URL)).rejects.toThrow()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  it('一意制約以外の失敗はそのまま投げる', async () => {
    tx.ticketLink.create.mockRejectedValue(new Error('boom'))

    await expect(addTicketLink(actor, 't1', URL)).rejects.toThrow('boom')
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('listTicketLinks', () => {
  it('CI は、このボードの対応付けを経由して届いたものだけを引く', async () => {
    const db = {
      ticketLink: {
        findMany: vi.fn(async () => [
          { id: 'l1', provider: 'github', baseUrl: '', repo: 'o/r', headSha: 'aaa', kind: 'pull_request' },
          {
            id: 'l2',
            provider: 'gitlab',
            baseUrl: 'https://gitlab.com',
            repo: 'g/p',
            headSha: 'bbb',
            kind: 'pull_request',
          },
        ]),
      },
      boardRepository: { findMany: vi.fn(async () => [{ id: 'r1' }, { id: 'r2' }]) },
      gitCheckSuite: { findMany: vi.fn(async () => []) },
    }

    await listTicketLinks('t1', db as never)

    expect(db.boardRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { board: { tickets: { some: { id: 't1' } } } } }),
    )
    expect(db.gitCheckSuite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { provider: 'github', baseUrl: '', repo: 'o/r', headSha: 'aaa', repositoryId: { in: ['r1', 'r2'] } },
            {
              provider: 'gitlab',
              baseUrl: 'https://gitlab.com',
              repo: 'g/p',
              headSha: 'bbb',
              repositoryId: { in: ['r1', 'r2'] },
            },
          ],
        },
      }),
    )
  })
})
