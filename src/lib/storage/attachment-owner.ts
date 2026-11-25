/**
 * 添付の持ち主(配信の範囲)の型と、DB の列との変換(サーバー / クライアント共用)
 *
 * DB では `boardId` / `wikiSpaceId` の 2 列で表し、両方 null は全ログインユーザーへ配信してよい添付
 * (CHECK 制約 `attachment_owner_check` で同時には持たない)。ボード / スペースの削除で紐付けを外した添付は
 * 両方 null のまま `detachedAt` を持つ(`attachment_detached_check`)。
 */

/** 添付の持ち主。配信の可視判定はこれで決まる */
export type AttachmentOwner =
  | { kind: 'board'; boardId: string }
  | { kind: 'wikiSpace'; wikiSpaceId: string }
  /** お知らせ・アイコンなど、全ログインユーザーへ配信してよい添付 */
  | { kind: 'public' }

/** ボードか Wiki スペースに属する添付の持ち主(本文の添付先・削除時の紐付けの解除に使う) */
export type AttachmentTarget = Exclude<AttachmentOwner, { kind: 'public' }>

/** 保存されている添付の状態。持ち主に加えて、紐付けを外した削除待ち(誰にも配信しない)がある */
export type StoredAttachmentOwner = AttachmentOwner | { kind: 'detached' }

export const PUBLIC_ATTACHMENT_OWNER: AttachmentOwner = { kind: 'public' }

type OwnerColumns = { boardId: string | null; wikiSpaceId: string | null }

/** DB の列へ書く値 */
export const attachmentOwnerColumns = (owner: AttachmentOwner): OwnerColumns => ({
  boardId: owner.kind === 'board' ? owner.boardId : null,
  wikiSpaceId: owner.kind === 'wikiSpace' ? owner.wikiSpaceId : null,
})

/** DB の列から読む */
export const storedAttachmentOwnerOf = (row: OwnerColumns & { detachedAt: Date | null }): StoredAttachmentOwner => {
  if (row.detachedAt) {
    return { kind: 'detached' }
  }
  if (row.boardId) {
    return { kind: 'board', boardId: row.boardId }
  }
  if (row.wikiSpaceId) {
    return { kind: 'wikiSpace', wikiSpaceId: row.wikiSpaceId }
  }
  return PUBLIC_ATTACHMENT_OWNER
}

/** 応答とログに載せる形(`boardId` / `wikiSpaceId` のどちらか一方) */
export const attachmentTargetFields = (target: AttachmentTarget) =>
  target.kind === 'board' ? { boardId: target.boardId } : { wikiSpaceId: target.wikiSpaceId }
