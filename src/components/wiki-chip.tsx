'use client'

import { createEnumChip } from '@/components/enum-chip'
import { BellIcon, BellSlashIcon, ClockIcon } from '@/components/icon'
import type {
  WikiAnnouncementNotifyKind,
  WikiAnnouncementNotifySkipReason,
  WikiAnnouncementNotifyStatus,
  WikiAssignRole,
  WikiPageType,
  WikiSpaceRole,
  WikiSpaceType,
  WikiVisibility,
} from '@/generated/prisma/enums'
import type { WikiAnnounceState } from '@/lib/wiki/wiki-announcement-notify-rule'
import type { LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import type { FC } from 'react'
import { tv } from 'tailwind-variants'

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

const spaceTypeChip = createEnumChip<WikiSpaceType>({
  mixed: { item: 'wiki_space_type_mixed', color: 'default' },
  design_doc: { item: 'wiki_space_type_design_doc', color: 'accent' },
  announcement: { item: 'wiki_space_type_announcement', color: 'warning' },
})

/** スペースの区分 */
export const WikiSpaceTypeChip = spaceTypeChip.EnumChip
export const useWikiSpaceTypeOptions = spaceTypeChip.useOptions

const pageTypeChip = createEnumChip<WikiPageType>({
  page: { item: 'wiki_page_type_page', color: 'default' },
  design_doc: { item: 'wiki_page_type_design_doc', color: 'accent' },
})

/** ページの種類の選択肢 */
export const useWikiPageTypeOptions = pageTypeChip.useOptions
export const WikiPageTypeChip = pageTypeChip.EnumChip

const announceKindChip = createEnumChip<WikiAnnouncementNotifyKind>({
  published: { item: 'wiki_announce_kind_published', color: 'accent' },
  updated: { item: 'wiki_announce_kind_updated', color: 'default' },
})

/** アナウンスの通知の種類(初回 / 更新) */
export const WikiAnnounceKindChip = announceKindChip.EnumChip
export const useWikiAnnounceKindOptions = announceKindChip.useOptions

const announceStatusChip = createEnumChip<WikiAnnouncementNotifyStatus>({
  scheduled: { item: 'wiki_announce_status_scheduled', color: 'warning' },
  sent: { item: 'wiki_announce_status_sent', color: 'success' },
  canceled: { item: 'wiki_announce_status_canceled', color: 'default' },
  skipped: { item: 'wiki_announce_status_skipped', color: 'danger' },
})

/** アナウンスの通知の状態(履歴の行) */
export const WikiAnnounceStatusChip = announceStatusChip.EnumChip

const announceStateChip = createEnumChip<WikiAnnounceState>({
  none: { item: 'wiki_announce_state_none', color: 'default' },
  scheduled: { item: 'wiki_announce_status_scheduled', color: 'warning' },
  sent: { item: 'wiki_announce_state_sent', color: 'success' },
})

/** 一覧に出すページの通知の状態 */
export const WikiAnnounceStateChip = announceStateChip.EnumChip

const ANNOUNCE_STATE_ICON = {
  none: { Icon: BellSlashIcon, item: 'wiki_announce_state_none' },
  scheduled: { Icon: ClockIcon, item: 'wiki_announce_status_scheduled' },
  sent: { Icon: BellIcon, item: 'wiki_announce_state_sent' },
} as const satisfies Record<WikiAnnounceState, { Icon: FC<{ width?: number }>; item: LocaleItem }>

const announceStateIcon = tv({
  base: 'inline-flex shrink-0',
  variants: {
    state: { none: 'text-muted', scheduled: 'text-warning', sent: 'text-success' },
  },
})

/** サイドバー向けの小さな通知の状態。幅を取らないようアイコンだけにし、文言は読み上げとツールチップに出す */
export const WikiAnnounceStateIcon: FC<{ value: WikiAnnounceState }> = ({ value }) => {
  const { t } = useLocale()
  const { Icon, item } = ANNOUNCE_STATE_ICON[value]
  const label = t(item)
  return (
    <span role='img' aria-label={label} title={label} className={announceStateIcon({ state: value })}>
      <Icon width={14} />
    </span>
  )
}

const SKIP_REASON_ITEM = {
  archived: 'wiki_announce_skip_archived',
  channel_unset: 'wiki_announce_skip_channel_unset',
  slack_disabled: 'wiki_announce_skip_slack_disabled',
  no_permission: 'wiki_announce_skip_no_permission',
  page_deleted: 'wiki_announce_skip_page_deleted',
} as const satisfies Record<WikiAnnouncementNotifySkipReason, LocaleItem>

/** 予約を見送った理由 */
export const WikiAnnounceSkipReason: FC<{ reason: WikiAnnouncementNotifySkipReason }> = ({ reason }) => {
  const { t } = useLocale()
  return <>{t(SKIP_REASON_ITEM[reason])}</>
}
