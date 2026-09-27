/**
 * GitHub 連携ユーティリティ(URL の解析・PR の状態)
 *
 * NOTE: このファイルはクライアントからも import されるため、サーバー専用の処理(prisma / 署名検証など)は
 * `github-webhook.ts` / `github-signature.ts` に配置する。GitLab と共通の処理は `../git/git.ts` に置く。
 */

import type { PullRequestState, TicketLinkKind } from '@/generated/prisma/enums'

export const GITHUB_ORIGIN = 'https://github.com'

/** Webhook の受け口。末尾に対応付け(BoardRepository)の ID を付ける */
export const GITHUB_WEBHOOK_PATH = '/api/github/webhook'

export const githubWebhookPath = (repositoryId: string): string => `${GITHUB_WEBHOOK_PATH}/${repositoryId}`

/** `owner/name` の形。GitHub のユーザー名・リポジトリ名に使える文字だけを許す */
const REPO_PATTERN = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/

/**
 * リポジトリの指定を `owner/name`(小文字)へ揃える。形式外は null。
 * GitHub は大文字小文字を区別しないので、保存・照合は小文字で行う。
 * 画面から貼られやすい URL(`https://github.com/owner/name(.git)`)も受け付ける。
 */
export const normalizeGithubRepo = (raw: string): string | null => {
  let value = raw.trim()
  if (value.startsWith(`${GITHUB_ORIGIN}/`)) {
    value = value.slice(GITHUB_ORIGIN.length + 1)
  }
  value = value.replace(/\/+$/, '').replace(/\.git$/, '')
  const matched = REPO_PATTERN.exec(value)
  if (!matched || matched[2] === '.' || matched[2] === '..') {
    return null
  }
  return `${matched[1]}/${matched[2]}`.toLowerCase()
}

export type GithubArtifact = {
  kind: TicketLinkKind
  /** `owner/name`(小文字) */
  repo: string
  /** branch: ブランチ名 / pull_request: PR 番号 / commit: SHA(小文字) */
  ref: string
  /** 正規化した URL */
  url: string
}

const encodeBranch = (branch: string): string => branch.split('/').map(encodeURIComponent).join('/')

export const githubPullRequestUrl = (repo: string, number: number | string): string =>
  `${GITHUB_ORIGIN}/${repo}/pull/${number}`

export const githubBranchUrl = (repo: string, branch: string): string =>
  `${GITHUB_ORIGIN}/${repo}/tree/${encodeBranch(branch)}`

export const githubCommitUrl = (repo: string, sha: string): string => `${GITHUB_ORIGIN}/${repo}/commit/${sha}`

const PR_NUMBER_PATTERN = /^[1-9]\d{0,9}$/
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

/**
 * GitHub の URL からブランチ / PR / コミットを読み取る。対応しない URL は null。
 *
 * - PR: `/owner/name/pull/123`(`/files` などのタブが続いてもよい)
 * - ブランチ: `/owner/name/tree/<ブランチ名>`(`/` を含むブランチ名もそのまま受ける)
 * - コミット: `/owner/name/commit/<SHA>`
 */
export const parseGithubUrl = (raw: string): GithubArtifact | null => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.origin !== GITHUB_ORIGIN) {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 4) {
    return null
  }
  const repo = normalizeGithubRepo(`${segments[0]}/${segments[1]}`)
  if (!repo) {
    return null
  }

  const [, , type, ...rest] = segments
  if (type === 'pull' && PR_NUMBER_PATTERN.test(rest[0])) {
    return { kind: 'pull_request', repo, ref: rest[0], url: githubPullRequestUrl(repo, rest[0]) }
  }
  if (type === 'commit' && rest.length === 1 && SHA_PATTERN.test(rest[0])) {
    const sha = rest[0].toLowerCase()
    return { kind: 'commit', repo, ref: sha, url: githubCommitUrl(repo, sha) }
  }
  if (type === 'tree') {
    let branch: string
    try {
      branch = rest.map(decodeURIComponent).join('/')
    } catch {
      return null
    }
    // `%20` や `%2F` を渡されると、デコード後に空白だけ・`/` で始まるか終わる実在しない名前になる
    if (!branch.trim() || branch.startsWith('/') || branch.endsWith('/')) {
      return null
    }
    return { kind: 'branch', repo, ref: branch, url: githubBranchUrl(repo, branch) }
  }
  return null
}

/** PR の状態。Webhook の pull_request から決める */
export const pullRequestStateOf = (pr: {
  state: string
  draft?: boolean
  merged?: boolean | null
}): PullRequestState => {
  if (pr.merged) {
    return 'merged'
  }
  if (pr.state === 'closed') {
    return 'closed'
  }
  return pr.draft ? 'draft' : 'open'
}
