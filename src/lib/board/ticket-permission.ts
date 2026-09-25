/**
 * ボード / チケットの権限判定(純粋関数)
 *
 * DB アクセスを伴う認可判定は `board-access.ts` を参照。
 */

import type { BoardWhereInput } from '@/generated/prisma/models'

export type BoardRole = 'owner' | 'member'

/**
 * ボードの実効ロールを解決する。
 * - 直接メンバー(BoardMember)のロールが最優先
 * - グループ経由(BoardGroup)は常に member 相当
 * - どちらも無ければ null(アクセス不可)
 *
 * 管理者特権はここに含めない。管理者は /admin/boards で管理操作のみ可能で、
 * アサインされていないボードの中身は見えない(要件の「/boards = 自分がアサインされているボード一覧」に合わせる)。
 */
export const resolveBoardRole = (directRole: BoardRole | null, hasGroupAccess: boolean): BoardRole | null =>
  directRole ?? (hasGroupAccess ? 'member' : null)

/** `userId` がメンバー(直接 / グループ経由)であるボードの条件。可視判定の where で共通に使う */
export const boardVisibleWhere = (userId: string): BoardWhereInput => ({
  OR: [{ members: { some: { userId } } }, { groups: { some: { group: { userGroups: { some: { userId } } } } } }],
})

export type TicketAccessInput = {
  userId: string
  createdById: string | null
  /** resolveBoardRole の戻り値。null ならそのボードにアクセスできない */
  boardRole: BoardRole | null
  /** 所属ボードがアーカイブ済みか。アーカイブ済みは読み取り専用にする */
  archived: boolean
  /** 担当エージェントの承認者か。担当がエージェントでなければ常に false */
  isAgentApprover: boolean
}

export type TicketPermission = {
  canView: boolean
  /** タイトル/本文/タグ/優先度/期限/担当/ステータスの変更 + コメント投稿 */
  canEdit: boolean
  canDelete: boolean
  /** エージェントモードの変更(= 自動実行の承認)。ボードの権限とは独立した軸 */
  canEditAgentMode: boolean
}

/**
 * チケットの権限。メンバー(owner|member)は view/edit、delete は owner または作成者。
 *
 * プライベートチケットも「自分が owner のプライベートボード」に属するため、
 * ここを通るだけで従来の「本人のみ全操作可」と同じ結果になる(分岐は不要)。
 *
 * アーカイブ済みボードは閲覧だけ許し、チケットへの書き込み(編集 / 削除 / 移動 /
 * ステータス変更 / コメント)を一律で塞ぐ。ボード自体の設定変更は別経路
 * (assertBoardAccess)なので、アーカイブの解除は引き続き可能。
 *
 * エージェントモードの変更だけは承認者の軸で決まる。ボードの owner でも承認者でなければ
 * 変更できず、逆に承認者はボードのメンバーでなくても閲覧と変更ができる。
 */
export const evaluateTicketAccess = ({
  userId,
  createdById,
  boardRole,
  archived,
  isAgentApprover,
}: TicketAccessInput): TicketPermission => {
  const isMember = boardRole !== null
  const canWrite = isMember && !archived
  return {
    // 承認者はボードのメンバーでなくても、担当エージェントのチケットを確認できる
    canView: isMember || isAgentApprover,
    canEdit: canWrite,
    canDelete: canWrite && (boardRole === 'owner' || createdById === userId),
    canEditAgentMode: isAgentApprover && !archived,
  }
}

/**
 * MCP限定の追加制限: メンバーは他人が担当のチケットを更新できない(未割り当てなら可能)。
 * オーナーはこの制限を受けない(Web版の canEdit と同じ)。
 */
export const canMcpUpdateTicket = (input: {
  userId: string
  boardRole: BoardRole | null
  assigneeId: string | null
}): boolean => input.boardRole !== 'member' || input.assigneeId === null || input.assigneeId === input.userId

/**
 * MCP限定の追加制限: オーナー・メンバーいずれも、自分が作成したチケットのみ削除できる。
 * Web版の canDelete(owner または作成者)より厳しい。
 */
export const canMcpDeleteTicket = (input: { userId: string; createdById: string | null }): boolean =>
  input.createdById === input.userId

/**
 * owner が 0 人になるアサインは owner 自身には許可しない(ボードが管理不能になる)。
 * 管理者は /admin/boards から実施できる。
 *
 * `ownerIds` には操作を適用した後の owner 一覧を渡す。
 */
export const canApplyAssignments = ({ ownerIds, byAdmin }: { ownerIds: string[]; byAdmin: boolean }): boolean =>
  byAdmin || ownerIds.length > 0
