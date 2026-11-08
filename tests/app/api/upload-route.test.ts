/**
 * アップロード API(`/api/upload`)と配信 API(`/api/upload/<キー>`)の Wiki スペースの扱い
 *
 * アップロードはスペースへ書き込める人(editor 以上 かつ 未アーカイブ)だけが添付先に指定でき、
 * 配信はそのスペースを閲覧できる人だけに返す。閲覧できない人には未存在と同じ 404 を返す。
 * 権限の解決は本物の wiki-access を通し、prisma は割り当てを絞り込んだ後の行を返す形で差し替える。
 */

import { GET } from '@/app/api/upload/[filename]/route'
import { POST } from '@/app/api/upload/route'
import { getActiveSession } from '@/lib/auth/auth'
import { prisma } from '@/lib/prisma'
import { saveContentFile, saveContentImage } from '@/lib/storage/attachment'
import { getObject } from '@/lib/storage/storage'
import { UPLOAD_BOARD_ID_FIELD, UPLOAD_WIKI_SPACE_ID_FIELD } from '@/lib/storage/upload'
import type { WikiRole } from '@/lib/wiki/wiki-rule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma(
    { wikiSpace: ['findUnique'], attachment: ['findUnique'], board: ['findUnique'] },
    { stubOthers: true },
  ),
)
vi.mock('@/lib/auth/auth', () => ({ getActiveSession: vi.fn() }))
vi.mock('@/lib/storage/upload-token', () => ({
  resolveUploadToken: vi.fn(async () => null),
  resolveDownloadToken: vi.fn(async () => null),
}))
vi.mock('@/lib/storage/attachment', () => ({ saveContentImage: vi.fn(), saveContentFile: vi.fn() }))
vi.mock('@/lib/storage/storage', () => ({ getObject: vi.fn() }))
vi.mock('@/lib/maintenance/maintenance-mode', () => ({ isMaintenanceMode: () => false }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: () => true }))

const SPACE_ID = '019eef64-6cc1-78f1-8f50-1ef869860010'
const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860020'
const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
const URL_OF_KEY = `/api/upload/${KEY}`

const user = { id: 'u1', role: 'user' }

const mockSpace = (fixture: { visibility?: 'restricted' | 'everyone'; direct?: WikiRole; archived?: boolean }) =>
  vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue({
    id: SPACE_ID,
    key: 'DOCS',
    visibility: fixture.visibility ?? 'restricted',
    archived: fixture.archived ?? false,
    members: fixture.direct ? [{ role: fixture.direct }] : [],
    groups: [],
    boards: [],
  } as never)

const postImage = (fields: Record<string, string>, kind?: 'file') => {
  const form = new FormData()
  form.append('file', new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }))
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value)
  }
  const url = `http://localhost:3000/api/upload${kind ? `?kind=${kind}` : ''}`
  return POST(new Request(url, { method: 'POST', body: form }))
}

const getFile = () =>
  GET(new Request(`http://localhost:3000${URL_OF_KEY}`), { params: Promise.resolve({ filename: KEY }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getActiveSession).mockResolvedValue({ user } as never)
  vi.mocked(saveContentImage).mockResolvedValue({ url: URL_OF_KEY, key: KEY, size: 3 })
  vi.mocked(saveContentFile).mockResolvedValue({ url: URL_OF_KEY, key: KEY, size: 3 })
  vi.mocked(getObject).mockResolvedValue({ body: new ReadableStream(), contentLength: 3 })
})

describe('POST /api/upload(Wiki スペースを添付先にする)', () => {
  it('editor はスペースを添付先にして画像を保存できる', async () => {
    mockSpace({ direct: 'editor' })

    const res = await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: URL_OF_KEY })
    expect(saveContentImage).toHaveBeenCalledWith(expect.any(File), {
      userId: 'u1',
      boardId: null,
      wikiSpaceId: SPACE_ID,
    })
  })

  it('ファイル添付でもスペースを添付先にできる', async () => {
    mockSpace({ direct: 'editor' })

    const res = await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID }, 'file')

    expect(res.status).toBe(200)
    expect(saveContentFile).toHaveBeenCalledWith(expect.any(File), {
      userId: 'u1',
      boardId: null,
      wikiSpaceId: SPACE_ID,
    })
  })

  it.each([
    ['viewer', { direct: 'viewer' as const }],
    ['割り当ての無い everyone のスペース', { visibility: 'everyone' as const }],
    ['アーカイブ済みのスペースの editor', { direct: 'editor' as const, archived: true }],
  ])('%s は 403', async (_, fixture) => {
    mockSpace(fixture)

    const res = await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID })

    expect(res.status).toBe(403)
    expect(saveContentImage).not.toHaveBeenCalled()
  })

  it('スペースが無ければ 403', async () => {
    vi.mocked(prisma.wikiSpace.findUnique).mockResolvedValue(null)

    expect((await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID })).status).toBe(403)
  })

  it('uuidv7 でない指定は 400', async () => {
    expect((await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: 'DOCS' })).status).toBe(400)
    expect(prisma.wikiSpace.findUnique).not.toHaveBeenCalled()
  })

  it('ボードとスペースを同時に指定すると 400', async () => {
    const res = await postImage({ [UPLOAD_BOARD_ID_FIELD]: BOARD_ID, [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID })

    expect(res.status).toBe(400)
    expect(saveContentImage).not.toHaveBeenCalled()
  })

  it('未ログインは 401', async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null)

    expect((await postImage({ [UPLOAD_WIKI_SPACE_ID_FIELD]: SPACE_ID })).status).toBe(401)
  })
})

describe('GET /api/upload/[filename](Wiki スペースの添付)', () => {
  beforeEach(() => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue({
      mimeType: 'image/webp',
      boardId: null,
      wikiSpaceId: SPACE_ID,
      originalName: 'shot.png',
    } as never)
  })

  it('スペースを閲覧できる人には配信する', async () => {
    mockSpace({ direct: 'viewer' })

    const res = await getFile()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
  })

  it('everyone のスペースは割り当てが無くても配信する', async () => {
    mockSpace({ visibility: 'everyone' })

    expect((await getFile()).status).toBe(200)
  })

  it('閲覧できない人には未存在と同じ 404 を返し、ストレージを読まない', async () => {
    mockSpace({})

    const res = await getFile()

    expect(res.status).toBe(404)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('割り当ての無い管理者にも 404', async () => {
    vi.mocked(getActiveSession).mockResolvedValue({ user: { id: 'admin', role: 'admin' } } as never)
    mockSpace({})

    expect((await getFile()).status).toBe(404)
  })
})
