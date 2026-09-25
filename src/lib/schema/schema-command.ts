/**
 * リモート実行(ターゲットのアサイン / 実行要求 / 実行履歴)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { COMMAND_ID_PATTERN, COMMAND_RUN_SORT_COLUMNS, COMMAND_RUN_STATUSES } from '../command/command'
import { zPagingFields } from './schema'
import { zBoardRole } from './schema-board'

/**
 * ターゲットの識別子。定義ファイルの `target.id` で、DB の UUID ではない。
 *
 * アサインはこのキーで持つ(ターゲットの実体は YAML 側にあり DB に行が無い)。
 */
export const zCommandTargetKey = z.string().regex(COMMAND_ID_PATTERN, el('@invalid_command_input'))
export const scCommandTargetKey = z.object({ targetKey: zCommandTargetKey })
export type CommandTargetKeyIn = z.input<typeof scCommandTargetKey>

/** ターゲットへのユーザー単位のアサイン。追加と更新で同じ形 */
export const scUpsertCommandTargetMember = z.object({
  targetKey: zCommandTargetKey,
  // 未選択(空文字)のままの送信をフォーム側でも弾けるようメッセージを付ける
  userId: z.uuidv7(el('@required_field')),
  role: zBoardRole,
})
export type UpsertCommandTargetMember = z.infer<typeof scUpsertCommandTargetMember>

/** 直接メンバー1行の解除。グループ経由メンバーには使えない */
export const scRemoveCommandTargetMember = z.object({
  targetKey: zCommandTargetKey,
  userId: z.uuidv7(),
})

/** グループ単位のアサイン。総入れ替えで受け取る */
export const scSetCommandTargetGroups = z.object({
  targetKey: zCommandTargetKey,
  groupIds: z.array(z.uuidv7()).default([]),
})

/**
 * コマンドの実行要求。
 *
 * `params` の中身は定義ごとに形が違うので、ここでは器の形だけを見る。
 * 値が選択肢の中にあるか(フリー入力なら使える文字と長さに収まっているか)は
 * `resolveCommandArgs`(`src/lib/command/command-args.ts`)が定義を突き合わせて確かめる。
 * 入力欄の種別がどれでも値は文字列・文字列配列・真偽値のどれかになるので、器はこの3つで足りる。
 */
export const scStartCommandRun = z.object({
  commandKey: z.string().regex(COMMAND_ID_PATTERN, el('@invalid_command_input')),
  params: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.boolean()])),
})
export type StartCommandRun = z.infer<typeof scStartCommandRun>

/**
 * 実行履歴の問い合わせ条件。
 *
 * 一般ユーザーは自分の実行だけが対象で、管理者は `scope: 'all'` で全件を見られる。
 * 並び順の扱いは {@link scTicketListQuery} と同じで、想定外の列名は既定へ落とす。
 */
export const scCommandRunListQuery = z.object({
  /** 'all' は管理者のみ。一般ユーザーが指定してもサーバー側で自分の分に絞る */
  scope: z.enum(['mine', 'all']).default('mine'),
  /** 未指定 = 絞り込みなし。コマンド定義のID(画面の絞り込みと URL の検証で共用する) */
  commandKey: z.string().regex(COMMAND_ID_PATTERN).nullish(),
  /** 空配列 = 絞り込みなし */
  status: z.array(z.enum(COMMAND_RUN_STATUSES)).default([]),
  ...zPagingFields(COMMAND_RUN_SORT_COLUMNS, 'queuedAt'),
})
export type CommandRunListQuery = z.infer<typeof scCommandRunListQuery>
export type CommandRunListQueryIn = z.input<typeof scCommandRunListQuery>
