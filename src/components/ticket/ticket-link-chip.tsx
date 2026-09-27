'use client'

import { createEnumChip } from '@/components/enum-chip'
import { type GitWebhookAuth, type PullRequestState } from '@/generated/prisma/enums'
import { type CiStatus } from '@/lib/git/git'

/** Prisma の enum が増えたらここがコンパイルエラーになる */
export const PullRequestStateChip = createEnumChip<PullRequestState>({
  open: { color: 'success', item: 'pr_state_open' },
  draft: { color: 'default', item: 'pr_state_draft' },
  merged: { color: 'accent', item: 'pr_state_merged' },
  closed: { color: 'danger', item: 'pr_state_closed' },
}).EnumChip

export const CiStatusChip = createEnumChip<CiStatus>({
  pending: { color: 'warning', item: 'ci_status_pending' },
  success: { color: 'success', item: 'ci_status_success' },
  failure: { color: 'danger', item: 'ci_status_failure' },
  cancelled: { color: 'default', item: 'ci_status_cancelled' },
}).EnumChip

/** GitLab の Webhook の検証方式。推奨の署名トークン以外は注意の色にする */
const gitWebhookAuthChip = createEnumChip<GitWebhookAuth>({
  signing: { color: 'success', item: 'gitlab_signing_token' },
  token: { color: 'warning', item: 'gitlab_secret_token' },
})
export const GitWebhookAuthChip = gitWebhookAuthChip.EnumChip
export const useGitWebhookAuthOptions = gitWebhookAuthChip.useOptions
