/** GitHub の URL 解析・PR の状態 */

import { normalizeGithubRepo, parseGithubUrl, pullRequestStateOf } from '@/lib/github/github'
import { describe, expect, it } from 'vitest'

describe('normalizeGithubRepo', () => {
  it('owner/name を小文字へ揃える', () => {
    expect(normalizeGithubRepo(' Owner/Repo.JS ')).toBe('owner/repo.js')
  })

  it('URL や .git 付きも受け付ける', () => {
    expect(normalizeGithubRepo('https://github.com/owner/repo.git')).toBe('owner/repo')
    expect(normalizeGithubRepo('https://github.com/owner/repo/')).toBe('owner/repo')
  })

  it('形式外は null', () => {
    expect(normalizeGithubRepo('owner')).toBeNull()
    expect(normalizeGithubRepo('owner/repo/extra')).toBeNull()
    expect(normalizeGithubRepo('owner/..')).toBeNull()
    expect(normalizeGithubRepo('https://example.com/owner/repo')).toBeNull()
  })
})

describe('parseGithubUrl', () => {
  it('PR の URL を読む(タブが続いてもよい)', () => {
    expect(parseGithubUrl('https://github.com/Owner/Repo/pull/12/files')).toEqual({
      kind: 'pull_request',
      repo: 'owner/repo',
      ref: '12',
      url: 'https://github.com/owner/repo/pull/12',
    })
  })

  it('スラッシュを含むブランチ名をそのまま読む', () => {
    expect(parseGithubUrl('https://github.com/owner/repo/tree/feature/ABC-1')).toEqual({
      kind: 'branch',
      repo: 'owner/repo',
      ref: 'feature/ABC-1',
      url: 'https://github.com/owner/repo/tree/feature/ABC-1',
    })
  })

  it('コミットの SHA は小文字へ揃える', () => {
    expect(parseGithubUrl('https://github.com/owner/repo/commit/ABCDEF1')?.ref).toBe('abcdef1')
  })

  it('GitHub 以外・対応しないページは null', () => {
    expect(parseGithubUrl('https://gitlab.com/owner/repo/pull/1')).toBeNull()
    expect(parseGithubUrl('http://github.com/owner/repo/pull/1')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/issues/1')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/pull/abc')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/commit/xyz')).toBeNull()
    expect(parseGithubUrl('not a url')).toBeNull()
  })

  it('デコードすると空白だけ・区切りで始まるか終わるブランチ名は受け付けない', () => {
    expect(parseGithubUrl('https://github.com/owner/repo/tree/%20')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/tree/%2F')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/tree/%2Ffeature')).toBeNull()
    expect(parseGithubUrl('https://github.com/owner/repo/tree/feature%2F')).toBeNull()
  })
})

describe('pullRequestStateOf', () => {
  it('マージ > クローズ > ドラフト > オープン', () => {
    expect(pullRequestStateOf({ state: 'closed', merged: true })).toBe('merged')
    expect(pullRequestStateOf({ state: 'closed', merged: false })).toBe('closed')
    expect(pullRequestStateOf({ state: 'open', draft: true })).toBe('draft')
    expect(pullRequestStateOf({ state: 'open', draft: false, merged: null })).toBe('open')
  })
})
