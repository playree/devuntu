/**
 * クライアントIPの取得(レート制限のキー)の単体テスト
 *
 * `x-forwarded-for` の先頭はクライアントが自由に書けるため、信頼するプロキシが記録した
 * 末尾側の値を採ることを固定する。
 */

import { getClientIp, pickForwardedClientIp } from '@/lib/server-utils'
import { headers } from 'next/headers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ env: { TRUSTED_PROXY_COUNT: 1 } }))

vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/lib/env-util', () => ({ envu: { server: mocks.env } }))

const mockHeaders = (values: Record<string, string>) =>
  vi.mocked(headers).mockResolvedValue(new Headers(values) as never)

describe('pickForwardedClientIp: x-forwarded-for からの選択', () => {
  it('プロキシ 1 段なら末尾(プロキシが付け足した接続元)を採る', () => {
    expect(pickForwardedClientIp('198.51.100.9, 203.0.113.1', 1)).toBe('203.0.113.1')
  })

  it('プロキシ 2 段なら末尾から 2 番目を採る', () => {
    expect(pickForwardedClientIp('198.51.100.9, 203.0.113.1, 10.0.0.2', 2)).toBe('203.0.113.1')
  })

  it('要素が段数より少なければ先頭を採る', () => {
    expect(pickForwardedClientIp('203.0.113.1', 2)).toBe('203.0.113.1')
  })

  it('送信元ポートは外す(ポートを変えて別のキーにさせない)', () => {
    expect(pickForwardedClientIp('198.51.100.9, 203.0.113.1:54321', 1)).toBe('203.0.113.1')
    expect(pickForwardedClientIp('[2001:db8::1]:54321', 1)).toBe('2001:db8::1')
    expect(pickForwardedClientIp('[2001:db8::1]', 1)).toBe('2001:db8::1')
    // ポートの無い IPv6 はそのまま
    expect(pickForwardedClientIp('2001:db8::1', 1)).toBe('2001:db8::1')
  })

  it('空白と空要素は無視する', () => {
    expect(pickForwardedClientIp(' 198.51.100.9 ,, 203.0.113.1 ', 1)).toBe('203.0.113.1')
    expect(pickForwardedClientIp(' , ', 1)).toBeUndefined()
  })
})

describe('getClientIp: クライアントIPの取得', () => {
  beforeEach(() => {
    mocks.env.TRUSTED_PROXY_COUNT = 1
  })

  it('先頭を詐称しても、信頼するプロキシが記録した値を採る', async () => {
    mockHeaders({ 'x-forwarded-for': '198.51.100.9, 203.0.113.1' })
    expect(await getClientIp()).toBe('203.0.113.1')
  })

  it('TRUSTED_PROXY_COUNT に従って末尾から数える', async () => {
    mocks.env.TRUSTED_PROXY_COUNT = 2
    mockHeaders({ 'x-forwarded-for': '198.51.100.9, 203.0.113.1, 10.0.0.2' })
    expect(await getClientIp()).toBe('203.0.113.1')
  })

  it('x-forwarded-for が無ければ x-real-ip、それも無ければ unknown', async () => {
    mockHeaders({ 'x-real-ip': ' 203.0.113.5 ' })
    expect(await getClientIp()).toBe('203.0.113.5')

    mockHeaders({})
    expect(await getClientIp()).toBe('unknown')
  })
})
