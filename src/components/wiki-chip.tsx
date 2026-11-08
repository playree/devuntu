'use client'

import { createEnumChip } from '@/components/enum-chip'
import type { WikiAssignRole, WikiSpaceRole, WikiVisibility } from '@/generated/prisma/enums'

const roleChip = createEnumChip<WikiSpaceRole>({
  owner: { item: 'owner', color: 'accent' },
  editor: { item: 'wiki_role_editor', color: 'success' },
  viewer: { item: 'wiki_role_viewer', color: 'default' },
})

/** Wiki スペースでのロール */
export const WikiRoleChip = roleChip.EnumChip
/** ユーザーの直接割り当てで選べるロール(owner を含む) */
export const useWikiRoleOptions = roleChip.useOptions

/** グループ・ボードの割り当てで選べるロール(owner はユーザーの直接割り当てに限る) */
export const useWikiAssignRoleOptions = (): Record<WikiAssignRole, string> => {
  const { owner: _owner, ...options } = roleChip.useOptions()
  return options
}

const visibilityChip = createEnumChip<WikiVisibility>({
  restricted: { item: 'wiki_visibility_restricted', color: 'default' },
  everyone: { item: 'wiki_visibility_everyone', color: 'warning' },
})

/** スペースの公開範囲 */
export const WikiVisibilityChip = visibilityChip.EnumChip
export const useWikiVisibilityOptions = visibilityChip.useOptions
