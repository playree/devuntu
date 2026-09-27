/** GitLab のインスタンス・プロジェクトの URL の解析、MR / パイプラインの状態の変換 */

import {
  looksLikeGitlabUrl,
  mergeRequestStateOf,
  normalizeGitlabBaseUrl,
  normalizeGitlabProjectPath,
  parseGitlabUrl,
  pipelineCheckStatusOf,
} from '@/lib/gitlab/gitlab'
import { describe, expect, it } from 'vitest'

const BASE_URLS = ['https://gitlab.com', 'https://example.com/gitlab']

describe('normalizeGitlabBaseUrl', () => {
  it('末尾の / を外し、ホストは小文字にする', () => {
    expect(normalizeGitlabBaseUrl('https://GitLab.Example.com/')).toBe('https://gitlab.example.com')
    expect(normalizeGitlabBaseUrl(' https://example.com/gitlab/ ')).toBe('https://example.com/gitlab')
    expect(normalizeGitlabBaseUrl('http://gitlab.local:8080')).toBe('http://gitlab.local:8080')
  })

  it('http(s) 以外・認証情報やクエリ付きは受けない', () => {
    expect(normalizeGitlabBaseUrl('ftp://gitlab.com')).toBeNull()
    expect(normalizeGitlabBaseUrl('https://user:pass@gitlab.com')).toBeNull()
    expect(normalizeGitlabBaseUrl('https://gitlab.com?a=1')).toBeNull()
    expect(normalizeGitlabBaseUrl('gitlab.com')).toBeNull()
  })
})

describe('normalizeGitlabProjectPath', () => {
  it('パスを小文字にそろえる(入れ子のグループも受ける)', () => {
    expect(normalizeGitlabProjectPath('Group/Sub/Project', 'https://gitlab.com')).toBe('group/sub/project')
    expect(normalizeGitlabProjectPath('/group/project.git/', 'https://gitlab.com')).toBe('group/project')
    expect(normalizeGitlabProjectPath('https://gitlab.com/group/project.git?ref=main', 'https://gitlab.com')).toBe(
      'group/project',
    )
  })

  it('インスタンスの URL で始まるプロジェクトの URL も受ける', () => {
    expect(normalizeGitlabProjectPath('https://example.com/gitlab/group/project', 'https://example.com/gitlab')).toBe(
      'group/project',
    )
    expect(normalizeGitlabProjectPath('https://gitlab.com/group/project/-/tree/main', 'https://gitlab.com')).toBe(
      'group/project',
    )
  })

  it('形式外は null', () => {
    expect(normalizeGitlabProjectPath('project', 'https://gitlab.com')).toBeNull()
    expect(normalizeGitlabProjectPath('group/-project', 'https://gitlab.com')).toBeNull()
    expect(normalizeGitlabProjectPath('group/pro ject', 'https://gitlab.com')).toBeNull()
    expect(normalizeGitlabProjectPath('group//project', 'https://gitlab.com')).toBeNull()
  })
})

describe('parseGitlabUrl', () => {
  it('MR(タブ付きも)', () => {
    expect(
      parseGitlabUrl('https://gitlab.com/Group/Sub/Proj/-/merge_requests/12/diffs?view=inline', BASE_URLS),
    ).toEqual({
      baseUrl: 'https://gitlab.com',
      kind: 'pull_request',
      repo: 'group/sub/proj',
      ref: '12',
      url: 'https://gitlab.com/group/sub/proj/-/merge_requests/12',
    })
  })

  it('サブパスに置いたインスタンスでは、サブパスをプロジェクトのパスに含めない', () => {
    expect(parseGitlabUrl('https://example.com/gitlab/group/proj/-/commit/ABCDEF1234', BASE_URLS)).toEqual({
      baseUrl: 'https://example.com/gitlab',
      kind: 'commit',
      repo: 'group/proj',
      ref: 'abcdef1234',
      url: 'https://example.com/gitlab/group/proj/-/commit/abcdef1234',
    })
  })

  it('/ を含むブランチ名', () => {
    expect(parseGitlabUrl('https://gitlab.com/group/proj/-/tree/feature/ABC-1', BASE_URLS)).toMatchObject({
      kind: 'branch',
      ref: 'feature/ABC-1',
      url: 'https://gitlab.com/group/proj/-/tree/feature/ABC-1',
    })
  })

  it('許可していないインスタンス・対応しない URL は null', () => {
    expect(parseGitlabUrl('https://gitlab.other.com/group/proj/-/merge_requests/1', BASE_URLS)).toBeNull()
    // サブパスの無い同じホストは許可していない
    expect(parseGitlabUrl('https://example.com/group/proj/-/merge_requests/1', BASE_URLS)).toBeNull()
    expect(parseGitlabUrl('https://gitlab.com/group/proj/-/issues/1', BASE_URLS)).toBeNull()
    expect(parseGitlabUrl('https://gitlab.com/group/proj/-/merge_requests/0', BASE_URLS)).toBeNull()
    expect(parseGitlabUrl('https://gitlab.com/proj/-/merge_requests/1', BASE_URLS)).toBeNull()
    expect(parseGitlabUrl('https://gitlab.com/group/proj/-/tree/%2F', BASE_URLS)).toBeNull()
    expect(parseGitlabUrl('not a url', BASE_URLS)).toBeNull()
  })
})

describe('looksLikeGitlabUrl', () => {
  it('インスタンスを問わず形だけを見る', () => {
    expect(looksLikeGitlabUrl('https://git.internal/group/proj/-/merge_requests/3')).toBe(true)
    expect(looksLikeGitlabUrl('https://git.internal/group/proj/-/merge_requests/3/diffs')).toBe(true)
    expect(looksLikeGitlabUrl('https://git.internal/group/proj/-/commit/abc1234/')).toBe(true)
    expect(looksLikeGitlabUrl('https://git.internal/group/proj/-/merge_requests/0')).toBe(false)
    expect(looksLikeGitlabUrl('https://git.internal/group/proj/-/pipelines/3')).toBe(false)
  })
})

describe('mergeRequestStateOf', () => {
  it('merged / closed / draft / open。locked はマージ処理中なので open', () => {
    expect(mergeRequestStateOf({ state: 'merged' })).toBe('merged')
    expect(mergeRequestStateOf({ state: 'closed' })).toBe('closed')
    expect(mergeRequestStateOf({ state: 'opened', draft: true })).toBe('draft')
    expect(mergeRequestStateOf({ state: 'opened', work_in_progress: true })).toBe('draft')
    expect(mergeRequestStateOf({ state: 'opened', draft: false })).toBe('open')
    expect(mergeRequestStateOf({ state: 'locked' })).toBe('open')
  })
})

describe('pipelineCheckStatusOf', () => {
  it('パイプラインの status を Check Suite の形へ寄せる', () => {
    expect(pipelineCheckStatusOf('success')).toEqual({ status: 'completed', conclusion: 'success' })
    expect(pipelineCheckStatusOf('failed')).toEqual({ status: 'completed', conclusion: 'failure' })
    expect(pipelineCheckStatusOf('canceled')).toEqual({ status: 'completed', conclusion: 'cancelled' })
    expect(pipelineCheckStatusOf('skipped')).toEqual({ status: 'completed', conclusion: 'skipped' })
    expect(pipelineCheckStatusOf('manual')).toEqual({ status: 'completed', conclusion: 'neutral' })
    expect(pipelineCheckStatusOf('running')).toEqual({ status: 'in_progress', conclusion: null })
    expect(pipelineCheckStatusOf('unknown_status')).toEqual({ status: 'in_progress', conclusion: null })
  })
})
