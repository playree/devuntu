'use client'

import { LocaleItemBase } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip, ChipProps } from '@heroui/react'
import { FC } from 'react'

/**
 * アサインのロール。
 *
 * ボード(`BoardRole`)とリモート実行のターゲット(`CommandTargetRole`)で同じ 2 値を使うため、
 * どちらのドメインにも寄せずここで受ける。
 */
export type AssignRole = 'owner' | 'member'

/** ロールのロケールキーと表示色。owner だけ色を変えて権限差を目立たせる */
const ROLE_STYLE: Record<AssignRole, { item: LocaleItemBase; color: ChipProps['color'] }> = {
  owner: { item: 'owner', color: 'accent' },
  member: { item: 'member', color: 'default' },
}

/**
 * ロールの Chip。
 * グループ経由のみのメンバーは直接ロールを持たないため、null の扱いは呼び出し側に任せる。
 */
export const RoleChip: FC<{ role: AssignRole; size?: ChipProps['size'] }> = ({ role, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = ROLE_STYLE[role]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

/** ロールの選択肢(Record<id, label>)。RoleChip と同じ文言を SingleSelectCtrl へ渡す */
export const useRoleOptions = (): Record<AssignRole, string> => {
  const { t } = useLocale()
  return { owner: t(ROLE_STYLE.owner.item), member: t(ROLE_STYLE.member.item) }
}
