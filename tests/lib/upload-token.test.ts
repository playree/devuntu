/**
 * 画像アップロード用の短命トークンの単体テスト
 *
 * `/api/upload` へ MCP クライアントを通すための資格情報なので、
 * 「他のトークンと取り違えない」「使い回せない」「発行後の権限変化に追従する」ことを確かめる。
 */

import { getBoardAccess } from '@/lib/board/board'
import { signUploadToken, UPLOAD_TOKEN_TTL_SECONDS, verifyUploadToken } from '@/lib/storage/upload-token'
import { generateKeyPair, SignJWT } from 'jose'
import { uuidv7 } from 'uuidv7'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findUser: vi.fn() }))

/**
 * `user` だけ差し替え、それ以外は vitest.setup.ts のスタブと同じ振る舞いにする
 * (better-auth の初期化が oauthResource を引くため、丸ごと差し替えると初期化が落ちる)。
 */
vi.mock('@/lib/prisma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prisma')>()),
  prisma: new Proxy(
    {},
    {
      get: (_target, model) =>
        model === 'user'
          ? { findUnique: mocks.findUser }
          : { findFirst: async () => ({}), findUnique: async () => ({}) },
    },
  ),
}))

vi.mock('@/lib/board/board', () => ({
  getBoardAccess: vi.fn(),
}))

const USER_ID = '019eef64-6cc1-78f1-8f50-1ef869860001'
const BOARD_ID = '019eef64-6cc1-78f1-8f50-1ef869860002'

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
  mocks.findUser.mockResolvedValue({ id: USER_ID, role: null, banned: false })
  vi.mocked(getBoardAccess).mockResolvedValue({ boardId: BOARD_ID } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('signUploadToken / verifyUploadToken', () => {
  it('発行したトークンから実行者と添付先ボードを復元できる', async () => {
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toEqual({ userId: USER_ID, boardId: BOARD_ID })
  })

  it('同じトークンは2回目以降を拒否する', async () => {
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).not.toBeNull()
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
    mocks.findUser.mockResolvedValue({ id: USER_ID, role: null, banned: true })
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })

  it('発行後にボードのアクセス権を失った場合を拒否する', async () => {
    vi.mocked(getBoardAccess).mockResolvedValue(null)
    const token = await signUploadToken({ userId: USER_ID, boardId: BOARD_ID })

    expect(await verifyUploadToken(token)).toBeNull()
  })
})
