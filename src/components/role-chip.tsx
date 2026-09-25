'use client'

import { createEnumChip } from '@/components/enum-chip'

/**
 * アサインのロール。
 *
 * ボード(`BoardRole`)とリモート実行のターゲット(`CommandTargetRole`)で同じ 2 値を使うため、
 * どちらのドメインにも寄せずここで受ける。
 */
export type AssignRole = 'owner' | 'member'

/** owner だけ色を変えて権限差を目立たせる */
const roleChip = createEnumChip<AssignRole>({
  owner: { item: 'owner', color: 'accent' },
  member: { item: 'member', color: 'default' },
})

/**
 * ロールの Chip。
 * グループ経由のみのメンバーは直接ロールを持たないため、null の扱いは呼び出し側に任せる。
 */
export const RoleChip = roleChip.EnumChip

/** ロールの選択肢(Record<id, label>)。RoleChip と同じ文言を SingleSelectCtrl へ渡す */
export const useRoleOptions = roleChip.useOptions
