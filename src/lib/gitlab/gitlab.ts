/**
 * GitLab 連携ユーティリティ(インスタンス・プロジェクトの URL の解析、MR / パイプラインの状態の変換)
 *
 * gitlab.com とセルフホストの両方を扱う。セルフホストはサブパスに置かれることがある
 * (`https://example.com/gitlab`)ため、URL の解析には許可したインスタンスの URL(環境変数 GITLAB_URLS)を使い、
 * どこまでがインスタンスでどこからがプロジェクトのパスかを決める。
 *
 * NOTE: このファイルはクライアントからも import されるため、サーバー専用の処理(prisma / 署名検証など)は
 * `gitlab-webhook.ts` / `gitlab-signature.ts` に配置する。
 */

import type { PullRequestState, TicketLinkKind } from '@/generated/prisma/enums'

/** Webhook の受け口。末尾に対応付け(BoardRepository)の ID を付ける */
export const GITLAB_WEBHOOK_PATH = '/api/gitlab/webhook'

export const gitlabWebhookPath = (repositoryId: string): string => `${GITLAB_WEBHOOK_PATH}/${repositoryId}`

/**
 * インスタンスの URL を `https://host(:port)(/サブパス)` へ揃える。形式外は null。
 * 社内のセルフホストでは http のこともあるので http も受ける。
 */
export const normalizeGitlabBaseUrl = (raw: string): string | null => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    return null
  }
  if (url.search || url.hash) {
    return null
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** GitLab が作る署名トークンの形(`whsec_` + base64)。画面から貼られた値の確認に使う */
export const GITLAB_SIGNING_TOKEN_PATTERN = /^whsec_[A-Za-z0-9+/]+={0,2}$/

/** 表示用のインスタンス名(スキームを外したもの) */
export const gitlabInstanceLabel = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, '')

/** グループ / プロジェクトのパスの1階層。GitLab の命名規則(英数字・`_` `.` `-`、先頭は `-` 以外)に合わせる */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/

/** グループの入れ子は 20 階層まで */
const MAX_PATH_DEPTH = 21

const isValidProjectPath = (segments: string[]): boolean =>
  segments.length >= 2 &&
  segments.length <= MAX_PATH_DEPTH &&
  segments.every((segment) => PATH_SEGMENT_PATTERN.test(segment) && !/\.(git|atom)$/i.test(segment))

/** `base` 配下の URL なら、base より後ろのパス(先頭の `/` なし)を返す。大文字小文字は区別しない */
const stripBaseUrl = (value: string, baseUrl: string): string | null =>
  value.toLowerCase().startsWith(`${baseUrl.toLowerCase()}/`) ? value.slice(baseUrl.length + 1) : null

/**
 * プロジェクトの指定を `group/(subgroup/)project`(小文字)へ揃える。形式外は null。
 * GitLab のパスは大文字小文字を区別しないので、保存・照合は小文字で行う。
 * 画面から貼られやすいプロジェクトの URL(`<baseUrl>/group/project(.git)`、`/-/` 以降のタブ付き)も受け付ける。
 */
export const normalizeGitlabProjectPath = (raw: string, baseUrl: string): string | null => {
  let value = raw.trim()
  value = stripBaseUrl(value, baseUrl) ?? value
  value = value.split(/[?#]/)[0].split('/-/')[0]
  value = value.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
  const segments = value.split('/')
  if (!isValidProjectPath(segments)) {
    return null
  }
  return segments.join('/').toLowerCase()
}

export type GitlabArtifact = {
  baseUrl: string
  kind: TicketLinkKind
  /** プロジェクトのパス(小文字) */
  repo: string
  /** branch: ブランチ名 / pull_request: MR の iid / commit: SHA(小文字) */
  ref: string
  /** 正規化した URL */
  url: string
}

const encodeBranch = (branch: string): string => branch.split('/').map(encodeURIComponent).join('/')

export const gitlabMergeRequestUrl = (baseUrl: string, repo: string, iid: number | string): string =>
  `${baseUrl}/${repo}/-/merge_requests/${iid}`

export const gitlabBranchUrl = (baseUrl: string, repo: string, branch: string): string =>
  `${baseUrl}/${repo}/-/tree/${encodeBranch(branch)}`

export const gitlabCommitUrl = (baseUrl: string, repo: string, sha: string): string =>
  `${baseUrl}/${repo}/-/commit/${sha}`

const IID_PATTERN = /^[1-9]\d{0,9}$/
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

/** URL のうち、許可したインスタンスのどれの配下か。サブパスの入れ子に備えて長い方を優先する */
const findBaseUrl = (href: string, baseUrls: readonly string[]): string | null =>
  [...baseUrls].sort((a, b) => b.length - a.length).find((baseUrl) => stripBaseUrl(href, baseUrl) !== null) ?? null

/**
 * GitLab の URL からブランチ / MR / コミットを読み取る。対応しない URL・許可していないインスタンスの URL は null。
 *
 * - MR: `/<project>/-/merge_requests/123`(`/diffs` などのタブが続いてもよい)
 * - ブランチ: `/<project>/-/tree/<ブランチ名>`(`/` を含むブランチ名もそのまま受ける)
 * - コミット: `/<project>/-/commit/<SHA>`
 */
export const parseGitlabUrl = (raw: string, baseUrls: readonly string[]): GitlabArtifact | null => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const href = `${url.origin}${url.pathname}`
  const baseUrl = findBaseUrl(href, baseUrls)
  if (!baseUrl) {
    return null
  }

  const path = href.slice(baseUrl.length + 1)
  const separator = path.indexOf('/-/')
  if (separator < 0) {
    return null
  }
  const segments = path.slice(0, separator).split('/')
  if (!isValidProjectPath(segments)) {
    return null
  }
  const repo = segments.join('/').toLowerCase()

  const [type, ...rest] = path
    .slice(separator + 3)
    .split('/')
    .filter(Boolean)
  if (type === 'merge_requests' && IID_PATTERN.test(rest[0] ?? '')) {
    return { baseUrl, kind: 'pull_request', repo, ref: rest[0], url: gitlabMergeRequestUrl(baseUrl, repo, rest[0]) }
  }
  if (type === 'commit' && rest.length === 1 && SHA_PATTERN.test(rest[0])) {
    const sha = rest[0].toLowerCase()
    return { baseUrl, kind: 'commit', repo, ref: sha, url: gitlabCommitUrl(baseUrl, repo, sha) }
  }
  if (type === 'tree' && rest.length > 0) {
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
    return { baseUrl, kind: 'branch', repo, ref: branch, url: gitlabBranchUrl(baseUrl, repo, branch) }
  }
  return null
}

/**
 * GitLab のブランチ / MR / コミットの URL の形をしているか(インスタンスは問わない)。
 * クライアントはインスタンスの一覧を知らないので、入力欄の事前チェックにだけ使う。
 */
export const looksLikeGitlabUrl = (raw: string): boolean => {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    /\/-\/(merge_requests\/[1-9]\d*(\/|$)|commit\/[0-9a-f]{7,40}\/?$|tree\/.)/i.test(url.pathname)
  )
}

/**
 * MR の状態。Webhook の object_attributes から決める。
 * locked はマージ処理中の一時的な状態なので、まだ開いているものとして扱う。
 */
export const mergeRequestStateOf = (mr: {
  state: string
  draft?: boolean | null
  work_in_progress?: boolean | null
}): PullRequestState => {
  if (mr.state === 'merged') {
    return 'merged'
  }
  if (mr.state === 'closed') {
    return 'closed'
  }
  return (mr.draft ?? mr.work_in_progress) ? 'draft' : 'open'
}

/**
 * パイプラインの status を GitHub の Check Suite の形(status / conclusion)へ寄せる。
 * 集計(summarizeCheckSuites)を GitHub と共通にするため。
 *
 * - manual は手動のジョブ待ちで、放っておくと実行中のまま残るので、完了(neutral)として扱う
 * - skipped は成功と同じ扱い(結果の足を引っ張らない)
 * - 知らない status は実行中として扱う(次のイベントで確定する)
 */
export const pipelineCheckStatusOf = (status: string): { status: string; conclusion: string | null } => {
  switch (status) {
    case 'success':
      return { status: 'completed', conclusion: 'success' }
    case 'failed':
      return { status: 'completed', conclusion: 'failure' }
    case 'canceled':
    case 'canceling':
      return { status: 'completed', conclusion: 'cancelled' }
    case 'skipped':
      return { status: 'completed', conclusion: 'skipped' }
    case 'manual':
      return { status: 'completed', conclusion: 'neutral' }
    default:
      return { status: 'in_progress', conclusion: null }
  }
}
