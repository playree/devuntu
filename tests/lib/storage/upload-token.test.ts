/**
 * 画像アップロード用の短命トークンの単体テスト
 *
 * `/api/upload` へ MCP クライアントを通すための資格情報なので、
 * 「他のトークンと取り違えない」「使い回せない」「発行後の権限変化に追従する」ことを確かめる。
 */

import { getBoardAccess } from '@/lib/board/board-access'
import { prisma } from '@/lib/prisma'
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  signDownloadToken,
  signUploadToken,
  UPLOAD_TOKEN_TTL_SECONDS,
  verifyDownloadToken,
  verifyUploadToken,
} from '@/lib/storage/upload-token'
import { getWikiSpaceAccess } from '@/lib/wiki/wiki-access'
import { generateKeyPair, SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `user` と `uploadNonce` だけ差し替え、それ以外は vitest.setup.ts のスタブと同じ振る舞いにする
 * (better-auth の初期化が oauthResource を引くため、丸ごと差し替えると初期化が落ちる)。
 */
vi.mock('@/lib/prisma', async () =>
  (await import('../../helpers/prisma')).mockPrisma(
    { user: ['findUnique'], uploadNonce: ['create', 'deleteMany'] },
    { stubOthers: true },
  ),
)

vi.mock('@/lib/board/board-access', () => ({
  getBoardAccess: vi.fn(),
}))

vi.mock('@/lib/wiki/wiki-access', () => ({
  getWikiSpaceAccess: vi.fn(),
}))

const findUser = vi.mocked(prisma.user.findUnique)
const createNonce = vi.mocked(prisma.uploadNonce.create)
const deleteNonces = vi.mocked(prisma.uploadNonce.deleteMany)

const USER_ID = '019eef64-6cc1-78f1-8f50-1ef869860001'
const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'
const SPACE_ID = '019eef64-6cc1-78f1-8f50-1ef869860003'

const SECRET = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET)
const ISSUER = 'http://localhost:3000'
const AUDIENCE = 'http://localhost:3000/api/upload'

/** 検証側と同じ形のクレームで、発行の一部だけを差し替えたトークンを作る */
const forgeToken = async (override: { secret?: Uint8Array; audience?: string; issuer?: string }) =>
  new SignJWT({ boardId: BOARD_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER_ID)
    .setIssuer(override.issuer ?? ISSUER)
    .setAudience(override.audience ?? AUDIENCE)
    .setJti(uuidv7())
    .setIssuedAt()
    .setExpirationTime(`${UPLOAD_TOKEN_TTL_SECONDS}s`)
    .sign(override.secret ?? SECRET)

beforeEach(() => {
  vi.clearAllMocks()
  findUser.mockResolvedValue({ id: USER_ID, role: null, banned: false } as never)
  createNonce.mockResolvedValue({ jti: 'x' } as never)
  deleteNonces.mockResolvedValue({ count: 0 })
  vi.mocked(getBoardAccess).mockResolvedValue({ boardId: BOARD_ID, archived: false } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('signUploadToken / verifyUploadToken', () => {
  it('発行したトークンから実行者と添付先ボードを復元できる', async () => {
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toEqual({ userId: USER_ID, boardId: BOARD_ID })
  })

  it('同じトークンは2回目以降を拒否する(jti の一意制約違反)', async () => {
    createNonce.mockResolvedValueOnce({ jti: 'x' } as never).mockRejectedValue({ code: 'P2002' })
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).not.toBeNull()
    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('使用済み記録に失敗した場合は拒否する(fail-closed)', async () => {
    createNonce.mockRejectedValue(new Error('db down'))
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('有効期限を過ぎたトークンを拒否する', async () => {
    vi.useFakeTimers()
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })
    vi.advanceTimersByTime((UPLOAD_TOKEN_TTL_SECONDS + 60) * 1000)

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('用途(aud)が違うトークンを拒否する', async () => {
    const token = await forgeToken({ audience: 'http://localhost:3000/api/mcp' })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('発行元(iss)が違うトークンを拒否する', async () => {
    const token = await forgeToken({ issuer: 'http://evil.example.com' })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('別のシークレットで署名したトークンを拒否する', async () => {
    const token = await forgeToken({ secret: new TextEncoder().encode('another-secret') })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('RS256(OAuthのアクセストークン相当)で署名したトークンを拒否する', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const token = await new SignJWT({ boardId: BOARD_ID })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti(uuidv7())
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey)

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('ペイロードを改竄したトークンを拒否する', async () => {
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })
    const [header, payload, signature] = token.split('.')
    const tampered = JSON.parse(Buffer.from(payload as string, 'base64url').toString())
    tampered.boardId = '019eef64-6cc1-78f1-8f50-1ef869860099'
    const forged = [header, Buffer.from(JSON.stringify(tampered)).toString('base64url'), signature].join('.')

    expect(await verifyUploadToken(forged)).toBeNull()
  })

  it('発行後にBANされた利用者を拒否する', async () => {
    findUser.mockResolvedValue({ id: USER_ID, role: null, banned: true } as never)
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('発行後にボードのアクセス権を失った場合を拒否する', async () => {
    vi.mocked(getBoardAccess).mockResolvedValue(null)
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('発行後にアーカイブされたボードを拒否する', async () => {
    vi.mocked(getBoardAccess).mockResolvedValue({ boardId: BOARD_ID, archived: true } as never)
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('Wiki スペースを添付先にしたトークンは、利用時点で書き込めれば添付先を復元する', async () => {
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canWrite: true } as never)
    const token = await signUploadToken({ userId: USER_ID, wikiSpaceId: SPACE_ID })

    expect(await verifyUploadToken(token)).toEqual({ userId: USER_ID, boardId: null, wikiSpaceId: SPACE_ID })
    expect(getWikiSpaceAccess).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), SPACE_ID)
    expect(getBoardAccess).not.toHaveBeenCalled()
  })

  it('発行後に Wiki スペースへ書き込めなくなった(外された・アーカイブされた)場合を拒否する', async () => {
    vi.mocked(getWikiSpaceAccess).mockResolvedValue({ canWrite: false } as never)
    const token = await signUploadToken({ userId: USER_ID, wikiSpaceId: SPACE_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('添付先がボードと Wiki スペースの両方・どちらも無いトークンを拒否する', async () => {
    const forge = (claims: Record<string, string>) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(USER_ID)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(uuidv7())
        .setIssuedAt()
        .setExpirationTime(`${UPLOAD_TOKEN_TTL_SECONDS}s`)
        .sign(SECRET)

    expect(await verifyUploadToken(await forge({ boardId: BOARD_ID, wikiSpaceId: SPACE_ID }))).toBeNull()
    expect(await verifyUploadToken(await forge({}))).toBeNull()
  })
})

describe('signDownloadToken / verifyDownloadToken', () => {
  const KEY = '019eef64-6cc1-78f1-8f50-1ef86986289a.pdf'
  const OTHER_KEY = '019eef64-6cc1-78f1-8f50-1ef86986289b.pdf'

  it('発行したトークンから実行者を復元でき、期限内は繰り返し使える', async () => {
    const token = await signDownloadToken({ userId: USER_ID, key: KEY })

    expect(await verifyDownloadToken(token, KEY)).toEqual({ id: USER_ID, role: null })
    expect(await verifyDownloadToken(token, KEY)).toEqual({ id: USER_ID, role: null })
    expect(createNonce).not.toHaveBeenCalled()
  })

  it('別のファイルには使えない', async () => {
    const token = await signDownloadToken({ userId: USER_ID, key: KEY })

    expect(await verifyDownloadToken(token, OTHER_KEY)).toBeNull()
  })

  it('アップロード用トークンはダウンロードに使えず、ダウンロード用トークンはアップロードに使えない', async () => {
    const uploadToken = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })
    const downloadToken = await signDownloadToken({ userId: USER_ID, key: KEY })

    expect(await verifyDownloadToken(uploadToken, KEY)).toBeNull()
    expect(await verifyUploadToken(downloadToken)).toBeNull()
  })

  it('有効期限を過ぎたトークンを拒否する', async () => {
    vi.useFakeTimers()
    const token = await signDownloadToken({ userId: USER_ID, key: KEY })
    vi.advanceTimersByTime((DOWNLOAD_TOKEN_TTL_SECONDS + 60) * 1000)

    expect(await verifyDownloadToken(token, KEY)).toBeNull()
  })

  it('発行後にBANされた利用者を拒否する', async () => {
    findUser.mockResolvedValue({ id: USER_ID, role: null, banned: true } as never)
    const token = await signDownloadToken({ userId: USER_ID, key: KEY })

    expect(await verifyDownloadToken(token, KEY)).toBeNull()
  })
})
