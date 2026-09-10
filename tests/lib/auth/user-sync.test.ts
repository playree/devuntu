/**
 * OIDC/ソーシャルログイン時のプロフィール同期の単体テスト
 *
 * `User.image` に外部URLを残さないこと、既に持っている画像を消さないことが要点。
 * 誤ると全ユーザーのアバターや表示名を一斉に壊すため、分岐を固定しておく。
 */

import { resolveSyncedProfile } from '@/lib/auth/user-sync'
import { prisma } from '@/lib/prisma'
import { saveImageAttachmentFromUrl } from '@/lib/storage/attachment'
import { toUploadUrl } from '@/lib/storage/upload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))
vi.mock('@/lib/storage/attachment', () => ({ saveImageAttachmentFromUrl: vi.fn() }))

const email = 'user@example.com'
const key = '019eef64-6cc1-78f1-8f50-1ef86986289a.webp'
const copied = toUploadUrl(key)
const providerImage = 'https://idp.example.com/avatar.png'

const dbUser = (over: Partial<{ id: string; name: string; image: string | null; nameLocked: boolean }> = {}) => ({
  id: 'u1',
  name: 'DB Name',
  image: null,
  nameLocked: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser() as never)
  vi.mocked(saveImageAttachmentFromUrl).mockResolvedValue(copied)
})

describe('resolveSyncedProfile', () => {
  it('画像未設定ならIdPのアバターをコピーして管理下のURLを返す', async () => {
    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: providerImage })

    expect(saveImageAttachmentFromUrl).toHaveBeenCalledWith(providerImage, 'u1')
    expect(result).toEqual({ name: 'IdP Name', image: copied })
  })

  it('既に管理下の画像を持っていればコピーしない', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser({ image: copied }) as never)

    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: providerImage })

    expect(saveImageAttachmentFromUrl).not.toHaveBeenCalled()
    expect(result.image).toBeUndefined()
  })

  it('外部URLが残っているユーザーはコピーで置き換える', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser({ image: 'https://old.example.com/a.png' }) as never)

    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: providerImage })

    expect(result.image).toBe(copied)
  })

  it('コピーに失敗したら undefined を返して既存値を保つ', async () => {
    vi.mocked(saveImageAttachmentFromUrl).mockResolvedValue(undefined)

    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: providerImage })

    // null を返すと better-auth がそのまま image = NULL を書いてしまう
    expect(result.image).toBeUndefined()
    expect(result.image).not.toBeNull()
  })

  it('IdPがアバターを持たなければ何もしない', async () => {
    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: undefined })

    expect(saveImageAttachmentFromUrl).not.toHaveBeenCalled()
    expect(result.image).toBeUndefined()
  })

  it('ユーザーが未登録ならコピーせず外部URLも通さない', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: providerImage })

    expect(saveImageAttachmentFromUrl).not.toHaveBeenCalled()
    expect(result).toEqual({ name: 'IdP Name', image: undefined })
  })

  it('メールアドレスが無ければ照合できないので外部URLを通さない', async () => {
    const result = await resolveSyncedProfile(null, { name: 'IdP Name', image: providerImage })

    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(result).toEqual({ name: 'IdP Name', image: undefined })
  })

  it('nameLocked ならDBの現在の表示名を返す', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser({ nameLocked: true }) as never)

    const result = await resolveSyncedProfile(email, { name: 'IdP Name', image: undefined })

    // undefined を返すと better-auth の `name || ''` で空文字に潰される
    expect(result.name).toBe('DB Name')
  })
})
