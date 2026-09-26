/** GitHub の URL 解析・ブランチ名からの表示ID抽出・CI の集計 */

import {
  extractDisplayIdFromBranch,
  isAllPullRequestsDone,
  normalizeGithubRepo,
  parseGithubUrl,
  pullRequestStateOf,
  summarizeCheckSuites,
  ticketLinkLabel,
} from '@/lib/github/github'
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
})

describe('extractDisplayIdFromBranch', () => {
  it('先頭の区切りの直後の表示IDを読む', () => {
    expect(extractDisplayIdFromBranch('feature/ABC-12')).toEqual({ key: 'ABC', number: 12 })
    expect(extractDisplayIdFromBranch('ABC-12')).toEqual({ key: 'ABC', number: 12 })
  })

  it('派生ブランチは元の表示IDを指す', () => {
    expect(extractDisplayIdFromBranch('feature/ABC-12-2')).toEqual({ key: 'ABC', number: 12 })
    expect(extractDisplayIdFromBranch('fix/abc-12_retry')).toEqual({ key: 'ABC', number: 12 })
  })

  it('先頭以外にある表示IDは拾わない', () => {
    expect(extractDisplayIdFromBranch('feature/add-ABC-12')).toBeNull()
    expect(extractDisplayIdFromBranch('user/feature/ABC-12')).toBeNull()
    expect(extractDisplayIdFromBranch('feature/ABC-12x')).toBeNull()
    expect(extractDisplayIdFromBranch('main')).toBeNull()
  })
})

describe('summarizeCheckSuites', () => {
  const completed = (conclusion: string) => ({ status: 'completed', conclusion })

  it('1件も無ければ null', () => {
    expect(summarizeCheckSuites([])).toBeNull()
  })

  it('失敗が1つでもあれば、実行中が残っていても失敗', () => {
    expect(summarizeCheckSuites([completed('failure'), { status: 'in_progress', conclusion: null }])).toBe('failure')
    expect(summarizeCheckSuites([completed('success'), completed('timed_out')])).toBe('failure')
  })

  it('失敗が無く実行中があれば実行中', () => {
    expect(summarizeCheckSuites([completed('success'), { status: 'queued', conclusion: null }])).toBe('pending')
  })

  it('neutral / skipped は成功として扱う', () => {
    expect(summarizeCheckSuites([completed('success'), completed('neutral'), completed('skipped')])).toBe('success')
  })

  it('キャンセルは成功より強い', () => {
    expect(summarizeCheckSuites([completed('success'), completed('cancelled')])).toBe('cancelled')
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

describe('isAllPullRequestsDone', () => {
  it('すべて片付いていて1件以上マージされていれば true', () => {
    expect(isAllPullRequestsDone(['merged'])).toBe(true)
    expect(isAllPullRequestsDone(['merged', 'closed'])).toBe(true)
  })

  it('開いているものがあるか、マージが無ければ false', () => {
    expect(isAllPullRequestsDone(['merged', 'open'])).toBe(false)
    expect(isAllPullRequestsDone(['merged', null])).toBe(false)
    expect(isAllPullRequestsDone(['closed'])).toBe(false)
    expect(isAllPullRequestsDone([])).toBe(false)
  })
})

describe('ticketLinkLabel', () => {
  it('種別ごとの表示名', () => {
    expect(ticketLinkLabel({ kind: 'pull_request', repo: 'o/r', ref: '1' })).toBe('o/r#1')
    expect(ticketLinkLabel({ kind: 'commit', repo: 'o/r', ref: 'abcdef1234' })).toBe('o/r@abcdef1')
    expect(ticketLinkLabel({ kind: 'branch', repo: 'o/r', ref: 'feature/A-1' })).toBe('o/r:feature/A-1')
  })
})
