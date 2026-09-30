/**
 * Git 連携(GitHub / GitLab)で共通の処理(URL の振り分け・ブランチ名からの表示ID抽出・CI 結果の集計)
 *
 * NOTE: このファイルはクライアントからも import されるため、サーバー専用の処理(prisma / 署名検証など)は置かない。
 */

import type { GitProvider, GitWebhookAuth, PullRequestState, TicketLinkKind } from '@/generated/prisma/enums'
import { parseGithubUrl } from '../github/github'
import { looksLikeGitlabUrl, parseGitlabUrl } from '../gitlab/gitlab'

/** 連携する Git ホスティング */
export const GIT_PROVIDERS = ['github', 'gitlab'] as const satisfies readonly GitProvider[]

/** ボードの provider ごとの Git 連携の設定(BoardGitSetting) */
export type BoardGitSettingValue = {
  completeOnMerge: boolean
  autoRevise: boolean
  autoReviseLimit: number
}

/** BoardGitSetting の行が無い provider の設定。スキーマの既定値と揃える */
export const DEFAULT_BOARD_GIT_SETTING: BoardGitSettingValue = {
  completeOnMerge: false,
  autoRevise: false,
  autoReviseLimit: 3,
}

/** GitLab の Webhook の検証方式。signing(署名トークン)を既定・推奨にする */
export const GIT_WEBHOOK_AUTHS = ['signing', 'token'] as const satisfies readonly GitWebhookAuth[]

export type GitArtifact = {
  provider: GitProvider
  /** GitLab のインスタンスの URL。GitHub は空文字 */
  baseUrl: string
  kind: TicketLinkKind
  /** GitHub は `owner/name`、GitLab はプロジェクトのパス(小文字) */
  repo: string
  /** branch: ブランチ名 / pull_request: PR・MR の番号 / commit: SHA(小文字) */
  ref: string
  /** 正規化した URL */
  url: string
}

/**
 * GitHub / GitLab の URL からブランチ / PR(MR) / コミットを読み取る。対応しない URL は null。
 * GitLab は `gitlabBaseUrls`(環境変数 GITLAB_URLS)に含まれるインスタンスの URL だけを受ける。
 */
export const parseGitUrl = (raw: string, gitlabBaseUrls: readonly string[]): GitArtifact | null => {
  const github = parseGithubUrl(raw)
  if (github) {
    return { provider: 'github', baseUrl: '', ...github }
  }
  const gitlab = parseGitlabUrl(raw, gitlabBaseUrls)
  return gitlab && { provider: 'gitlab', ...gitlab }
}

/**
 * 入力欄の事前チェック用。GitLab はインスタンスの一覧(サーバーの環境変数)を知らないので形だけを見る。
 * 許可したインスタンスかどうかはサーバー側の parseGitUrl で判定する。
 */
export const looksLikeGitUrl = (raw: string): boolean => parseGithubUrl(raw) !== null || looksLikeGitlabUrl(raw)

/**
 * ブランチ名の先頭から表示ID(`KEY-番号`)を読み取る。無ければ null。
 *
 * 誤った紐付けを避けるため、見るのは先頭の区切り(`feature/KEY-1` の `/` の直後)か
 * ブランチ名の先頭にある最初の1件だけ。`feature/KEY-1-2` のような派生ブランチは KEY-1 を指す。
 * キーは大文字へ寄せる(`parseTicketDisplayId` と同じ扱い)。
 */
export const extractDisplayIdFromBranch = (branch: string): { key: string; number: number } | null => {
  const matched = /^(?:[^/]+\/)?([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,9})(?=$|[-_./])/.exec(branch)
  if (!matched) {
    return null
  }
  return { key: matched[1].toUpperCase(), number: Number(matched[2]) }
}

/** 画面に出す CI の結果。GitHub の status / conclusion(GitLab の pipeline もこの形へ寄せる)をまとめたもの */
export const CI_STATUSES = ['pending', 'success', 'failure', 'cancelled'] as const
export type CiStatus = (typeof CI_STATUSES)[number]

/** 失敗として扱う conclusion。対処が要るものをまとめる */
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'action_required', 'startup_failure', 'stale'])

/**
 * Check Suite の一覧から CI の結果をまとめる。1件も無ければ null(CI が無い / まだ始まっていない)。
 *
 * 失敗 > 実行中 > キャンセル > 成功 の順に強い。実行中のものがあっても、既に失敗が確定していれば失敗を出す。
 * neutral / skipped は成功と同じ扱い(結果の足を引っ張らない)。
 */
export const summarizeCheckSuites = (suites: { status: string; conclusion: string | null }[]): CiStatus | null => {
  if (suites.length === 0) {
    return null
  }
  if (suites.some(({ conclusion }) => conclusion && FAILURE_CONCLUSIONS.has(conclusion))) {
    return 'failure'
  }
  if (suites.some(({ status }) => status !== 'completed')) {
    return 'pending'
  }
  if (suites.some(({ conclusion }) => conclusion === 'cancelled')) {
    return 'cancelled'
  }
  return 'success'
}

/**
 * マージで完了にしてよいか。紐付いた PR がすべてマージかクローズで、少なくとも1件がマージされていること。
 * クローズだけ(マージせず閉じた)では完了にしない。
 */
export const isAllPullRequestsDone = (states: (PullRequestState | null)[]): boolean =>
  states.length > 0 && states.every((state) => state === 'merged' || state === 'closed') && states.includes('merged')

/** PR / MR の表示名。GitHub は `owner/name#123`、GitLab は `group/project!123` */
export const pullRequestLabel = (provider: GitProvider, repo: string, ref: string | number): string =>
  provider === 'gitlab' ? `${repo}!${ref}` : `${repo}#${ref}`

/** リンクの表示名。PR / MR は番号付き、コミットは短い SHA、ブランチは名前 */
export const ticketLinkLabel = ({
  provider,
  kind,
  repo,
  ref,
}: {
  provider: GitProvider
  kind: TicketLinkKind
  repo: string
  ref: string
}): string => {
  if (kind === 'pull_request') {
    return pullRequestLabel(provider, repo, ref)
  }
  if (kind === 'commit') {
    return `${repo}@${ref.slice(0, 7)}`
  }
  return `${repo}:${ref}`
}
