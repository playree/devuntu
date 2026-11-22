import type { WikiPageType } from '@/generated/prisma/enums'

/** 編集中のページの下書き(保存する項目) */
export type WikiPageDraft = {
  title: string
  content: string
  type: WikiPageType
  tagIds: readonly string[]
}

/** 下書きが編集を始めた時点から変わったか。タグは並びを問わず集合で比べる */
export const isWikiDraftChanged = (base: WikiPageDraft, draft: WikiPageDraft) => {
  if (base.title !== draft.title || base.content !== draft.content || base.type !== draft.type) {
    return true
  }
  const baseTagIds = new Set(base.tagIds)
  const draftTagIds = new Set(draft.tagIds)
  return baseTagIds.size !== draftTagIds.size || [...draftTagIds].some((id) => !baseTagIds.has(id))
}
