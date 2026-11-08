/**
 * 添付の配信可否(attachment-access.ts)のうち、Wiki スペースの添付
 *
 * Wiki の添付はスペースの閲覧権限だけで決まり、ボードの判定(承認者の扱いを含む)には落ちないことを確かめる。
 * ボードの添付は `tests/lib/board/board-access.test.ts` / `board-approver-access.test.ts` で見ている。
 * 権限の解決は本物の wiki-access を通し、prisma は割り当てを絞り込んだ後の行を返す形で差し替える。
 */

import { prisma } from '@/lib/prisma'
import { canViewAttachment } from '@/lib/storage/attachment-access'
import type { WikiRole } from '@/lib/wiki/wiki-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma({
    wikiSpace: ['findUnique'],
    board: ['findUnique'],
    ticket: ['count'],
  }),
)

const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
const SPACE_ID = 's1'
const user = { id: 'u1', role: 'user' }
const admin = { id: 'u1', role: 'admin' }
const attachment = { key: KEY, boardId: null, wikiSpaceId: SPACE_ID }

const mockSpace = (fixture: { visibility?: 'restricted' | 'everyone'; direct?: WikiRole; archived?: boolean } | null) =>
  vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(
    (fixture && {
      id: SPACE_ID,
      key: 'DOCS',
      visibility: fixture.visibility ?? 'restricted',
      archived: fixture.archived ?? false,
      members: fixture.direct ? [{ role: fixture.direct }] : [],
      groups: [],
      boards: [],
    }) as never,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canViewAttachment(Wiki スペースの添付)', () => {
  it('スペースの viewer なら読める', async () => {
    mockSpace({ direct: 'viewer' })
    expect(await canViewAttachment(user, attachment)).toBe(true)
    expect(prisma.board.findUnique).not.toHaveBeenCalled()
  })

  it('アーカイブ済みのスペースでも閲覧できる人は読める', async () => {
    mockSpace({ direct: 'editor', archived: true })
    expect(await canViewAttachment(user, attachment)).toBe(true)
  })

  it('割り当ての無い restricted のスペースは読めず、承認者の判定にも落ちない', async () => {
    mockSpace({})
    expect(await canViewAttachment(user, attachment)).toBe(false)
    expect(prisma.ticket.count).not.toHaveBeenCalled()
  })

  it('everyone のスペースは割り当てが無くても読める', async () => {
    mockSpace({ visibility: 'everyone' })
    expect(await canViewAttachment(user, attachment)).toBe(true)
  })

  it('割り当ての無い管理者は本文と同じく読めない', async () => {
    mockSpace({})
    expect(await canViewAttachment(admin, attachment)).toBe(false)
  })

  it('スペースが無ければ読めない(全ログインユーザー向けとして扱わない)', async () => {
    mockSpace(null)
    expect(await canViewAttachment(user, attachment)).toBe(false)
  })
})
