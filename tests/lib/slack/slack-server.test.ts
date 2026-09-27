/**
 * Slack Web API 呼び出しの単体テスト
 *
 * fetch とキャッシュ・待機を差し替え、HTTP / Slack の失敗をどの分類へ落とすか、
 * 送信系と取得系でボディの形式を取り違えないか、userinfo で連携を弾く条件を固定する。
 */

import { dropCached } from '@/lib/cache'
import {
  getSlackBotInfo,
  listSlackChannels,
  postSlackMessage,
  slackUserInfo,
  unfurlSlackLinks,
} from '@/lib/slack/slack-server'
import { sleep } from '@/lib/sleep'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, load: () => Promise<unknown>) => load()),
  dropCached: vi.fn(),
}))
vi.mock('@/lib/sleep', () => ({ sleep: vi.fn(async () => undefined) }))

const fetchMock = vi.fn<typeof fetch>()

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init)

/** n 回目の fetch に渡したリクエスト */
const request = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index]
  return { url: String(url), init: init as RequestInit & { headers: Record<string, string> } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  vi.stubEnv('SLACK_TEAM_ID', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('postSlackMessage: 送信と結果の分類', () => {
  const message = { text: 'テスト', blocks: [{ type: 'section' }] }

  it('Bot トークンで chat.postMessage に JSON で送る', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('ok')

    const { url, init } = request()
    expect(url).toBe('https://slack.com/api/chat.postMessage')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer xoxb-test')
    expect(init.headers['Content-Type']).toContain('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ channel: 'C0123ABCD', ...message })
  })

  it('Bot トークンが無ければ叩かずに revoked(送信を打ち切らせる)', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')

    expect(await postSlackMessage('C0123ABCD', message)).toBe('revoked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each<[string, () => Response | Promise<Response>, string]>([
    ['Slack の error コード', () => json({ ok: false, error: 'channel_not_found' }), 'unlinked'],
    ['トークン失効', () => json({ ok: false, error: 'token_revoked' }), 'revoked'],
    ['ok:false で error が無い', () => json({ ok: false }), 'failed'],
    ['5xx', () => new Response('', { status: 503 }), 'retryable'],
    ['JSON でない応答', () => new Response('<html>', { status: 200 }), 'failed'],
  ])('%s は %s', async (_label, respond, expected) => {
    fetchMock.mockImplementation(async () => respond())

    expect(await postSlackMessage('C0123ABCD', message)).toBe(expected)
  })

  it('ネットワーク断・タイムアウトは retryable', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('retryable')
  })

  it('レート制限は Retry-After だけ待って一度だけ再送する', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(json({ ok: true }))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('ok')
    expect(sleep).toHaveBeenCalledWith(3000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('Retry-After が無ければ 1 秒待つ', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(json({ ok: true }))

    await postSlackMessage('C0123ABCD', message)

    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('再送でもレート制限なら諦めて rate_limited', async () => {
    fetchMock.mockImplementation(async () => new Response('', { status: 429, headers: { 'retry-after': '1' } }))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('rate_limited')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('待ち時間が上限(5 秒)を超えるなら待たずに rate_limited', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '6' } }))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('rate_limited')
    expect(sleep).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('body の ok:false で返る ratelimited も再送の対象', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'ratelimited' })).mockResolvedValueOnce(json({ ok: true }))

    expect(await postSlackMessage('C0123ABCD', message)).toBe('ok')
    expect(sleep).toHaveBeenCalledWith(1000)
  })
})

describe('unfurlSlackLinks: 展開先の指定', () => {
  const unfurls = { 'http://localhost:3000/t/ABC-1': { blocks: [] } }

  it('unfurl_id + source で指定する', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }))

    expect(await unfurlSlackLinks({ unfurlId: 'unfurl-1', source: 'composer' }, unfurls)).toBe('ok')

    expect(request().url).toBe('https://slack.com/api/chat.unfurl')
    expect(JSON.parse(request().init.body as string)).toEqual({ unfurl_id: 'unfurl-1', source: 'composer', unfurls })
  })

  it('channel + ts で指定する', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }))

    await unfurlSlackLinks({ channel: 'C0123ABCD', ts: '1700000000.000100' }, unfurls)

    expect(JSON.parse(request().init.body as string)).toEqual({
      channel: 'C0123ABCD',
      ts: '1700000000.000100',
      unfurls,
    })
  })

  it('Bot が未参加なら unlinked', async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: 'not_in_channel' }))

    expect(await unfurlSlackLinks({ unfurlId: 'unfurl-1', source: 'composer' }, unfurls)).toBe('unlinked')
  })
})

describe('getSlackBotInfo', () => {
  it('Bot トークンが無ければ叩かずに null', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')

    expect(await getSlackBotInfo()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('auth.test の結果を返す(取得系なので form で送る)', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, team_id: 'T0123', team: 'テスト', url: 'https://example.slack.com/' }))

    expect(await getSlackBotInfo()).toEqual({ teamId: 'T0123', team: 'テスト', url: 'https://example.slack.com/' })
    expect(request().url).toBe('https://slack.com/api/auth.test')
    expect(request().init.headers['Content-Type']).toContain('application/x-www-form-urlencoded')
  })

  it('team / url が無ければ teamId と空文字で埋める', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, team_id: 'T0123' }))

    expect(await getSlackBotInfo()).toEqual({ teamId: 'T0123', team: 'T0123', url: '' })
  })

  it.each<[string, unknown]>([
    ['トークン不正', { ok: false, error: 'invalid_auth' }],
    ['team_id が無い', { ok: true }],
  ])('%s なら null', async (_label, body) => {
    fetchMock.mockResolvedValue(json(body))

    expect(await getSlackBotInfo()).toBeNull()
  })
})

describe('listSlackChannels', () => {
  it('参加しているチャンネルを form で引き、名前順に返す', async () => {
    fetchMock.mockResolvedValue(
      json({
        ok: true,
        channels: [
          { id: 'C0000000B', name: 'random' },
          { id: 'G0000000A', name: 'dev', is_private: true },
          { id: 'D0000000A' },
        ],
      }),
    )

    expect(await listSlackChannels()).toEqual([
      { id: 'G0000000A', name: 'dev', isPrivate: true },
      { id: 'C0000000B', name: 'random', isPrivate: false },
    ])

    const { url, init } = request()
    expect(url).toBe('https://slack.com/api/users.conversations')
    expect(init.headers['Content-Type'], 'JSON では types が黙って無視される').toContain(
      'application/x-www-form-urlencoded',
    )
    const params = new URLSearchParams(init.body as string)
    expect(params.get('types')).toBe('public_channel,private_channel')
    expect(params.get('exclude_archived')).toBe('true')
    expect(params.has('cursor')).toBe(false)
  })

  it('next_cursor がある間はページを辿る', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ ok: true, channels: [{ id: 'C0000000B', name: 'b' }], response_metadata: { next_cursor: 'next-1' } }),
      )
      .mockResolvedValueOnce(
        json({ ok: true, channels: [{ id: 'C0000000A', name: 'a' }], response_metadata: { next_cursor: '' } }),
      )

    expect((await listSlackChannels())?.map(({ id }) => id)).toEqual(['C0000000A', 'C0000000B'])
    expect(new URLSearchParams(request(1).init.body as string).get('cursor')).toBe('next-1')
  })

  it('ページングは 5 ページで打ち切り、取れた分を返す', async () => {
    let page = 0
    fetchMock.mockImplementation(async () => {
      page++
      return json({
        ok: true,
        channels: [{ id: `C000000${page}`, name: `ch-${page}` }],
        response_metadata: { next_cursor: `next-${page}` },
      })
    })

    expect(await listSlackChannels()).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('取得に失敗したら null(空配列=招待漏れとは区別する)', async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: 'missing_scope' }))

    expect(await listSlackChannels()).toBeNull()
  })

  it('途中のページで失敗しても null', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ ok: true, channels: [{ id: 'C0000000A', name: 'a' }], response_metadata: { next_cursor: 'next-1' } }),
      )
      .mockResolvedValueOnce(new Response('', { status: 500 }))

    expect(await listSlackChannels()).toBeNull()
  })

  it('Bot トークンが無ければ null', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')

    expect(await listSlackChannels()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('force のときだけキャッシュを捨てる', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true, channels: [] }))

    await listSlackChannels()
    expect(dropCached).not.toHaveBeenCalled()

    await listSlackChannels({ force: true })
    expect(dropCached).toHaveBeenCalledWith('slack:channels')
  })
})

describe('slackUserInfo: 連携の入口', () => {
  const profile = (override: Record<string, unknown> = {}) => ({
    ok: true,
    sub: 'sub-1',
    name: 'テストユーザー',
    email: 'user@example.com',
    email_verified: true,
    picture: 'https://example.com/avatar.png',
    'https://slack.com/user_id': 'U0123ABCD',
    'https://slack.com/team_id': 'T0123',
    ...override,
  })

  it('Slack ユーザーIDを sub にして返し、アバターは渡さない', async () => {
    fetchMock.mockResolvedValue(json(profile()))

    const info = await slackUserInfo({ accessToken: 'xoxp-user' })

    expect(info).toEqual({ sub: 'U0123ABCD', name: 'テストユーザー', email: 'user@example.com', emailVerified: true })
    expect(request().url).toBe('https://slack.com/api/openid.connect.userInfo')
    expect(request().init.headers.Authorization).toBe('Bearer xoxp-user')
  })

  it('Slack ユーザーIDが無ければ sub を使い、email_verified が無ければ false', async () => {
    fetchMock.mockResolvedValue(json(profile({ 'https://slack.com/user_id': undefined, email_verified: undefined })))

    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).toMatchObject({ sub: 'sub-1', emailVerified: false })
  })

  it('アクセストークンが無ければ叩かずに null', async () => {
    expect(await slackUserInfo({})).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SLACK_TEAM_ID と違うワークスペースは null', async () => {
    vi.stubEnv('SLACK_TEAM_ID', 'T9999')
    fetchMock.mockResolvedValue(json(profile()))

    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).toBeNull()
  })

  it('SLACK_TEAM_ID が一致すれば通す', async () => {
    vi.stubEnv('SLACK_TEAM_ID', 'T0123')
    fetchMock.mockResolvedValue(json(profile()))

    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).not.toBeNull()
  })

  it.each<[string, Record<string, unknown>]>([
    ['ok:false', { ok: false, error: 'invalid_auth' }],
    ['名前が無い', { name: undefined }],
    ['メールが無い', { email: undefined }],
    ['ID が無い', { sub: undefined, 'https://slack.com/user_id': undefined }],
  ])('%s なら null', async (_label, override) => {
    fetchMock.mockResolvedValue(json(profile(override)))

    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).toBeNull()
  })

  it('通信・JSON の失敗は null', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).toBeNull()

    fetchMock.mockResolvedValueOnce(new Response('<html>'))
    expect(await slackUserInfo({ accessToken: 'xoxp-user' })).toBeNull()
  })
})
