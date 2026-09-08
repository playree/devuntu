/**
 * メールへの配信の単体テスト
 *
 * 送信ドライバ(`mail.ts`)は差し替え、1 通へまとめる条件と載せる内容を検証する。
 */

import { MAX_DIGEST_ITEMS } from '@/lib/notify/notify'
import type { NotifyContent } from '@/lib/notify/notify-content'
import type { MailRecipient } from '@/lib/notify/notify-email'
import { deliverEmail } from '@/lib/notify/notify-email'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mail', () => ({ sendEmail: vi.fn(async () => undefined) }))

const { sendEmail } = await import('@/lib/mail')
const send = vi.mocked(sendEmail)

const recipient: MailRecipient = { id: 'user-1', email: 'test@test.dev', locale: 'ja' }

const content = (index: number, excerpt?: string): NotifyContent => ({
  subject: `[ABC-${index}] チケット${index}`,
  body: `検証さんがあなたをメンションしました(${index})`,
  url: `https://devuntu.example.com/t/ABC-${index}`,
  ...(excerpt && { excerpt }),
})

/** 送信されたメール */
const sent = () => send.mock.calls[0][0]

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue(undefined)
})

describe('deliverEmail: 1 件のとき', () => {
  it('件名は `[表示ID] チケット名` をそのまま使う(本文を開かずに判別できる)', async () => {
    await deliverEmail({ recipient, contents: [content(1)] })
    expect(sent().subject).toBe('[ABC-1] チケット1')
  })

  it('本文に文面とURLが入る', async () => {
    await deliverEmail({ recipient, contents: [content(1)] })
    const { text } = sent()
    expect(text).toContain('検証さんがあなたをメンションしました(1)')
    expect(text).toContain('https://devuntu.example.com/t/ABC-1')
    expect(text, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
  })

  it('抜粋があれば載せる', async () => {
    await deliverEmail({ recipient, contents: [content(1, 'iOS だけで再現')] })
    expect(sent().text).toContain('iOS だけで再現')
  })
})

describe('deliverEmail: まとめて送るとき', () => {
  it('複数件でも 1 通しか送らない', async () => {
    await deliverEmail({ recipient, contents: [content(1), content(2), content(3)] })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('件名は件数を示す(どのチケットの話か 1 件に絞れない)', async () => {
    await deliverEmail({ recipient, contents: [content(1), content(2)] })
    expect(sent().subject).toContain('2')
    expect(sent().subject).not.toContain('[ABC-1]')
  })

  it('全件を本文に並べる', async () => {
    await deliverEmail({ recipient, contents: [content(1), content(2), content(3)] })
    const { text } = sent()
    for (const index of [1, 2, 3]) {
      expect(text).toContain(`[ABC-${index}] チケット${index}`)
      expect(text).toContain(`https://devuntu.example.com/t/ABC-${index}`)
    }
    expect(text, '未置換のプレースホルダが残っていない').not.toMatch(/\$\{/)
  })

  it('項目ごとに抜粋の有無を出し分ける', async () => {
    await deliverEmail({ recipient, contents: [content(1, 'iOS だけで再現'), content(2)] })
    expect(sent().text).toContain('iOS だけで再現')
  })

  it('上限を超えた分は件数の 1 行へ畳む', async () => {
    const contents = Array.from({ length: MAX_DIGEST_ITEMS + 3 }, (_, index) => content(index))
    await deliverEmail({ recipient, contents })
    const { text } = sent()
    expect(text, '畳んだ分の本文は載せない').not.toContain(`[ABC-${MAX_DIGEST_ITEMS + 2}]`)
    expect(text, 'ほか3件').toContain('3')
  })
})

describe('deliverEmail: ロケール', () => {
  for (const locale of ['ja', 'en', null] as const) {
    it(`${locale ?? '既定'}: 単票 / 集約のどちらもプレースホルダが残らない`, async () => {
      await deliverEmail({ recipient: { ...recipient, locale }, contents: [content(1, '抜粋')] })
      await deliverEmail({ recipient: { ...recipient, locale }, contents: [content(1), content(2)] })
      for (const [{ subject, text }] of send.mock.calls) {
        expect(subject).not.toMatch(/\$\{/)
        expect(text).not.toMatch(/\$\{/)
      }
    })
  }
})

describe('deliverEmail: 結果の扱い', () => {
  it('送信できたら ok', async () => {
    expect(await deliverEmail({ recipient, contents: [content(1)] })).toBe('ok')
  })

  it('送れなかったら再試行に回す(構成ミスと一時障害を切り分けられない)', async () => {
    send.mockRejectedValueOnce(new Error('boom'))
    expect(await deliverEmail({ recipient, contents: [content(1)] })).toBe('retryable')
  })

  it('例外を呼び出し元へ伝えない(1 通の失敗で他のユーザーを巻き添えにしない)', async () => {
    send.mockRejectedValueOnce(new Error('boom'))
    await expect(deliverEmail({ recipient, contents: [content(1)] })).resolves.toBe('retryable')
  })

  it('送るものが無ければ送信を試みない', async () => {
    expect(await deliverEmail({ recipient, contents: [] })).toBe('ok')
    expect(send).not.toHaveBeenCalled()
  })
})
