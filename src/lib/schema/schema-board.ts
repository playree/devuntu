/**
 * ボード(作成 / 更新 / アーカイブ / 通知先 / メンバー)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { AUTO_REVISE_LIMIT_MAX, AUTO_REVISE_LIMIT_MIN } from '../agent/agent'
import { BOARD_KEY_PATTERN, isReservedBoardKey, MAX_BOARD_KEY } from '../board/ticket-id'
import { GIT_PROVIDERS, GIT_WEBHOOK_AUTHS } from '../git/git'
import { normalizeGithubRepo } from '../github/github'
import { GITLAB_SIGNING_TOKEN_PATTERN, normalizeGitlabProjectPath } from '../gitlab/gitlab'
import { CHANNEL_NOTIFY_EVENTS } from '../notify/notify'
import { SLACK_CHANNEL_ID_PATTERN } from '../slack/slack'
import { zName } from './schema'

export const zBoardDescription = z.string().max(200, el('@invalid_description')).optional()

/**
 * ボードキー(チケット表示ID `KEY-番号` の接頭辞)。小文字で入力されても大文字へ寄せてから検証する。
 * 変更すると共有済みの表示IDが解決できなくなるため、変更できるのは owner と管理者に限る。
 * プライベートボードの採番領域(PRV)は `isReservedBoardKey` で塞ぐ。
 */
export const zBoardKey = z
  .string()
  .trim()
  .toUpperCase()
  .max(MAX_BOARD_KEY, el('@invalid_board_key'))
  .regex(BOARD_KEY_PATTERN, el('@invalid_board_key'))
  .refine((key) => !isReservedBoardKey(key), el('@reserved_board_key'))
/** ボードのロール。Prisma の BoardMemberRole / ticket-permission.ts の BoardRole と一致させる */
export const zBoardRole = z.enum(['owner', 'member'])

export const scCreateBoard = z.object({
  name: zName,
  key: zBoardKey,
  description: zBoardDescription,
})
export type CreateBoard = z.infer<typeof scCreateBoard>

export const scUpdateBoard = z.object({
  id: z.uuidv7(),
  name: zName,
  key: zBoardKey,
  description: zBoardDescription,
})
export type UpdateBoard = z.infer<typeof scUpdateBoard>

/**
 * アーカイブの切り替え。プロフィール編集と経路を分けることで、
 * アーカイブ操作が画面に残っている古い name / key を書き戻さないようにする。
 */
export const scSetBoardArchived = z.object({
  id: z.uuidv7(),
  archived: z.boolean(),
})
export type SetBoardArchived = z.infer<typeof scSetBoardArchived>

/** ボードの AI 向けコンテキスト(Markdown)。空文字は未設定として保存する */
export const scSetBoardAiContext = z.object({
  id: z.uuidv7(),
  aiContext: z.string().max(8000),
})
export type SetBoardAiContext = z.infer<typeof scSetBoardAiContext>

/**
 * 通知先に選べる Slack チャンネルの一覧。`id` はボード ID。
 * `force` はキャッシュを捨てて Slack から取り直す(招待直後に一覧へ反映させるため)。
 */
export const scGetBoardSlackChannels = z.object({
  id: z.uuidv7(),
  force: z.boolean().optional(),
})

/**
 * ボードのチャネル通知(通知先の Slack チャンネル + 通知するイベント)。
 * アーカイブと同じく、プロフィール編集とは経路を分けて他の項目を書き戻さないようにする。
 *
 * 空文字は「通知しない」(= null へ正規化)。実在の確認は Bot が参加しているチャンネルの
 * 一覧と突き合わせて Server Action 側で行う。
 *
 * イベントは常に全部まとめて受け取り、サーバー側に部分更新の分岐を作らない。
 * 宛先が個人の DM だけのイベントはチャンネルへ出せないので受け付けない。
 */
export const scSetBoardNotifySetting = z.object({
  id: z.uuidv7(),
  slackChannelId: z.union([z.literal(''), z.string().regex(SLACK_CHANNEL_ID_PATTERN, el('@invalid_slack_channel'))]),
  events: z.array(z.enum(CHANNEL_NOTIFY_EVENTS)),
})
export type SetBoardNotifySetting = z.infer<typeof scSetBoardNotifySetting>

/**
 * メンバー管理 UI(components/assignment)の入力。ボード / コマンドのターゲット / エージェントの承認者で共有し、
 * 送信先の Server Action が各ドメインのスキーマで改めて検証する
 */
export const scAssignMember = z.object({
  // 未選択(空文字)のままの送信をフォーム側でも弾けるようメッセージを付ける
  userId: z.uuidv7(el('@required_field')),
  role: zBoardRole,
})
export type AssignMember = z.infer<typeof scAssignMember>

export const scAssignGroups = z.object({
  groupIds: z.array(z.uuidv7()),
})
export type AssignGroups = z.infer<typeof scAssignGroups>

/**
 * ユーザー単位のアサインをメンバー 1 人ずつ追加 / 変更する(owner も実行可能)。
 * グループ経由ユーザーへの直接ロール付与も同じ入力で表せる。
 * `id` はボード ID、`userId` が対象ユーザー。
 */
export const scUpsertBoardMember = z.object({
  id: z.uuidv7(),
  // 未選択(空文字)のままの送信をフォーム側でも弾けるようメッセージを付ける
  userId: z.uuidv7(el('@required_field')),
  role: zBoardRole,
})
export type UpsertBoardMember = z.infer<typeof scUpsertBoardMember>

/** 直接メンバー(BoardMember 行)の解除。グループ経由メンバーには使えない */
export const scRemoveBoardMember = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
})
export type RemoveBoardMember = z.infer<typeof scRemoveBoardMember>

/** グループ単位のアサイン(管理者のみ)。権限境界が違うためユーザー単位と分けている */
export const scSetBoardGroups = z.object({
  id: z.uuidv7(),
  groupIds: z.array(z.uuidv7()).default([]),
})
export type SetBoardGroups = z.infer<typeof scSetBoardGroups>

/** GitHub 連携で対応付けるリポジトリ(`owner/name` または URL) */
export const scAddBoardRepository = z.object({
  id: z.uuidv7(),
  repo: z
    .string()
    .trim()
    .min(1, el('@required_field'))
    .refine((repo) => normalizeGithubRepo(repo) !== null, el('@invalid_github_repo')),
})
export type AddBoardRepository = z.infer<typeof scAddBoardRepository>

/** GitLab 連携で対応付けるプロジェクト。インスタンスが許可したものかはサーバー側で判定する */
export const scAddBoardGitlabRepository = z
  .object({
    id: z.uuidv7(),
    baseUrl: z.string().min(1),
    project: z.string().trim().min(1, el('@required_field')).max(1000, el('@invalid_gitlab_project')),
    webhookAuth: z.enum(GIT_WEBHOOK_AUTHS),
  })
  .refine(({ baseUrl, project }) => normalizeGitlabProjectPath(project, baseUrl) !== null, {
    path: ['project'],
    error: el('@invalid_gitlab_project'),
  })
export type AddBoardGitlabRepository = z.infer<typeof scAddBoardGitlabRepository>

/** GitLab が作った署名トークン(`whsec_...`) */
export const scSetGitlabSigningToken = z.object({
  id: z.uuidv7(),
  repositoryId: z.uuidv7(),
  secret: z
    .string()
    .trim()
    .min(1, el('@required_field'))
    .max(1000, el('@invalid_gitlab_signing_token'))
    .regex(GITLAB_SIGNING_TOKEN_PATTERN, el('@invalid_gitlab_signing_token')),
})

/** 対応付けたリポジトリ1件への操作(解除・トークンの作り直し) */
export const scBoardRepositoryTarget = z.object({
  id: z.uuidv7(),
  repositoryId: z.uuidv7(),
})

/** provider ごとの Git 連携の設定。指定した項目だけを変える */
export const scSetBoardGitSetting = z.object({
  id: z.uuidv7(),
  provider: z.enum(GIT_PROVIDERS),
  completeOnMerge: z.boolean().optional(),
  autoRevise: z.boolean().optional(),
  autoReviseLimit: z.number().int().min(AUTO_REVISE_LIMIT_MIN).max(AUTO_REVISE_LIMIT_MAX).optional(),
})
