/** Git 連携で共通の処理(URL の振り分け・ブランチ名からの表示ID抽出・CI の集計) */

import {
  extractDisplayIdFromBranch,
  isAllPullRequestsDone,
  looksLikeGitUrl,
  mergeCompletionOf,
  parseGitUrl,
  summarizeCheckSuites,
  ticketLinkLabel,
  unmetMergeCriteria,
} from '@/lib/git/git'
import { describe, expect, it } from 'vitest'

describe('parseGitUrl', () => {
  const GITLAB = ['https://gitlab.com', 'https://git.example.com/gitlab']

  it('GitHub の URL は provider=github、baseUrl は空', () => {
    expect(parseGitUrl('https://github.com/Owner/Repo/pull/12', GITLAB)).toEqual({
      provider: 'github',
      baseUrl: '',
      kind: 'pull_request',
      repo: 'owner/repo',
      ref: '12',
      url: 'https://github.com/owner/repo/pull/12',
    })
  })

  it('許可した GitLab インスタンスの URL は provider=gitlab', () => {
    expect(parseGitUrl('https://git.example.com/gitlab/Group/Sub/Proj/-/merge_requests/3', GITLAB)).toEqual({
      provider: 'gitlab',
      baseUrl: 'https://git.example.com/gitlab',
      kind: 'pull_request',
      repo: 'group/sub/proj',
      ref: '3',
      url: 'https://git.example.com/gitlab/group/sub/proj/-/merge_requests/3',
    })
  })

  it('許可していないインスタンスの URL は null', () => {
    expect(parseGitUrl('https://gitlab.other.com/group/proj/-/merge_requests/3', GITLAB)).toBeNull()
    expect(parseGitUrl('https://gitlab.com/group/proj/-/merge_requests/3', [])).toBeNull()
  })
})

describe('looksLikeGitUrl', () => {
  it('GitHub の URL と、GitLab の形をした URL を受ける(インスタンスは問わない)', () => {
    expect(looksLikeGitUrl('https://github.com/owner/repo/pull/12')).toBe(true)
    expect(looksLikeGitUrl('https://gitlab.other.com/group/proj/-/merge_requests/3')).toBe(true)
    expect(looksLikeGitUrl('https://gitlab.other.com/group/proj/-/commit/abcdef1')).toBe(true)
    expect(looksLikeGitUrl('https://gitlab.other.com/group/proj/-/tree/feature/A-1')).toBe(true)
  })

  it('それ以外は受けない', () => {
    expect(looksLikeGitUrl('https://example.com/owner/repo/pull/12')).toBe(false)
    expect(looksLikeGitUrl('https://gitlab.com/group/proj/-/issues/3')).toBe(false)
    expect(looksLikeGitUrl('ftp://gitlab.com/group/proj/-/merge_requests/3')).toBe(false)
    expect(looksLikeGitUrl('not a url')).toBe(false)
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
    expect(ticketLinkLabel({ provider: 'github', kind: 'pull_request', repo: 'o/r', ref: '1' })).toBe('o/r#1')
    expect(ticketLinkLabel({ provider: 'github', kind: 'commit', repo: 'o/r', ref: 'abcdef1234' })).toBe('o/r@abcdef1')
    expect(ticketLinkLabel({ provider: 'github', kind: 'branch', repo: 'o/r', ref: 'feature/A-1' })).toBe(
      'o/r:feature/A-1',
    )
  })

  it('GitLab の MR は ! で番号を付ける', () => {
    expect(ticketLinkLabel({ provider: 'gitlab', kind: 'pull_request', repo: 'g/s/p', ref: '3' })).toBe('g/s/p!3')
  })
})

describe('unmetMergeCriteria', () => {
  const AT = new Date('2026-10-01T00:00:00Z')
  const CRITERIA = [
    { text: '人が確認', checkedAt: AT, agentMet: null },
    { text: '自己申告で達成', checkedAt: null, agentMet: true },
    { text: '自己申告で未達', checkedAt: null, agentMet: false },
    { text: '未申告', checkedAt: null, agentMet: null },
  ]

  it('チェックしないなら未達は無い', () => {
    expect(unmetMergeCriteria(CRITERIA, 'none')).toEqual([])
  })

  it('人の確認または自己申告なら、どちらでも満たしていない条件だけが未達', () => {
    expect(unmetMergeCriteria(CRITERIA, 'checkedOrReported')).toEqual(['自己申告で未達', '未申告'])
  })

  it('人の確認が必須なら、自己申告だけの条件も未達', () => {
    expect(unmetMergeCriteria(CRITERIA, 'checked')).toEqual(['自己申告で達成', '自己申告で未達', '未申告'])
  })

  it('受け入れ条件が無ければ未達は無い', () => {
    expect(unmetMergeCriteria([], 'checked')).toEqual([])
  })
})

describe('mergeCompletionOf', () => {
  it('マージで自動完了する provider だけを判定方法つきで返す', () => {
    expect(
      mergeCompletionOf([
        { provider: 'github', completeOnMerge: true, mergeCriteriaCheck: 'checkedOrReported' },
        { provider: 'gitlab', completeOnMerge: false, mergeCriteriaCheck: 'checked' },
      ]),
    ).toEqual({ github: { criteriaCheck: 'checkedOrReported' } })
  })

  it('自動完了する provider が無ければ undefined', () => {
    expect(mergeCompletionOf([])).toBeUndefined()
    expect(
      mergeCompletionOf([{ provider: 'github', completeOnMerge: false, mergeCriteriaCheck: 'none' }]),
    ).toBeUndefined()
  })
})
