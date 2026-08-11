'use client'

import type { BoardKind, TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import type { BoardRole } from '@/lib/task'
import { LocaleItemBase } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip, ChipProps, cn } from '@heroui/react'
import { FC, ReactNode, useCallback } from 'react'
import { tv } from 'tailwind-variants'

type ChipColor = ChipProps['color']

/**
 * ステータスのロケールキーと Chip の表示色。
 * color は Chip 用の HeroUI セマンティック名なので bg-* には使えない(配色は statusStyles を参照)。
 */
const STATUS_STYLE: Record<TicketStatus, { item: LocaleItemBase; color: ChipColor }> = {
  backlog: { item: 'status_backlog', color: 'default' },
  todo: { item: 'status_todo', color: 'accent' },
  doing: { item: 'status_doing', color: 'warning' },
  done: { item: 'status_done', color: 'success' },
}

/**
 * ステータスの背景色。StatusChip(STATUS_STYLE)と同じ色を 10% で敷き、下地を透かして淡く色を付ける。
 *
 * HeroUI のセマンティック名そのままでは bg-* に使えないが、色トークン(--color-accent など)は
 * @theme に登録されているので bg-accent/10 の形で同じ色を参照できる
 * (Tailwind v4 が color-mix(in oklab, var(--color-accent) 10%, transparent) に展開する)。
 * 実体の CSS 変数がテーマごとに切り替わるため dark: は要らない(priorityStyles との違い)。
 * 半透明なので単色の背景クラスとは併用できない(priorityBgClass と同じ制約)。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(tagStyles と同じ規約)。
 */
const statusStyles = tv({
  variants: {
    status: {
      backlog: 'bg-default/20',
      todo: 'bg-accent/5',
      doing: 'bg-warning/5',
      done: 'bg-success/5',
    } satisfies Record<TicketStatus, string>,
  },
})

/** ステータス色を 10% で敷いた背景クラス。className を渡すと tailwind-merge でマージされる */
export const statusBgClass = (status: TicketStatus, className?: string) => statusStyles({ status, className })

/**
 * 優先度のロケールキーと Chip の表示色。
 * color は Chip 用の HeroUI セマンティック名なので bg-* には使えない(配色は priorityStyles を参照)。
 * キーの並びは選択肢(useTicketOptions)の表示順になるので、優先度の高い順に保つこと。
 */
const PRIORITY_META: Record<TicketPriority, { item: LocaleItemBase; color: ChipColor }> = {
  urgent: { item: 'priority_urgent', color: 'danger' },
  high: { item: 'priority_high', color: 'warning' },
  medium: { item: 'priority_medium', color: 'accent' },
  low: { item: 'priority_low', color: 'default' },
}

/**
 * 優先度の配色。水平線(bar)・カード枠線(border)・カード背景(bg)を 1 箇所に集約する。
 * bar は 1px の線で面積が小さいため透過させず、bg は同系色を 10% で敷いて下地を透かす。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(tagStyles と同じ規約)。
 */
const priorityStyles = tv({
  slots: {
    /**
     * 塗りは持たず、上下のボーダーだけで 1px の水平線 2 本を作る。
     * box-border なので h-1.5(6px)の内訳が 線 1px / 余白 4px / 線 1px になる。
     * 幅を 90% に絞って中央寄せするのは、カードの角丸(rounded-xl)で上端の線だけが
     * 左右を削られて 2 本の長さがズレるのを避けるため(mt-1 で角の曲線からも逃がす)。
     * border スロットと同じ規約で、幅は常に確保して色だけ variants で変える。
     */
    bar: 'mx-auto mt-1 h-1 w-[94%] border-y border-transparent',
    // テーマ切り替えでレイアウトが動かないよう、枠の幅は常に確保しておく
    border: 'border-b-3 border-transparent',
    bg: '',
  },
  variants: {
    priority: {
      urgent: {
        bar: 'border-red-300/30 dark:border-red-800/30',
        border: 'dark:border-red-800/30',
        bg: 'bg-red-300/15 dark:bg-red-800/10',
      },
      high: {
        bar: 'border-amber-400/30 dark:border-amber-500/20',
        border: 'dark:border-amber-500/20',
        bg: 'bg-amber-400/15 dark:bg-amber-500/10',
      },
      medium: {
        bar: 'border-blue-300/30 dark:border-blue-800/30',
        border: 'dark:border-blue-800/30',
        bg: 'bg-blue-300/15 dark:bg-blue-800/10',
      },
      low: {
        bar: 'border-gray-300/30 dark:border-gray-600/30',
        border: 'dark:border-gray-600/30',
        bg: 'bg-gray-300/15 dark:bg-gray-600/10',
      },
    } satisfies Record<TicketPriority, unknown>,
  },
})

export const StatusChip: FC<{ status: TicketStatus; size?: ChipProps['size'] }> = ({ status, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = STATUS_STYLE[status]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

export const PriorityChip: FC<{ priority: TicketPriority; size?: ChipProps['size'] }> = ({ priority, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = PRIORITY_META[priority]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

/** ボードロールのロケールキーと表示色。owner だけ色を変えて権限差を目立たせる */
const ROLE_STYLE: Record<BoardRole, { item: LocaleItemBase; color: ChipColor }> = {
  owner: { item: 'owner', color: 'accent' },
  member: { item: 'member', color: 'default' },
}

/**
 * ボードロールの Chip。
 * グループ経由のみのメンバーは直接ロールを持たないため、null の扱いは呼び出し側に任せる。
 */
export const RoleChip: FC<{ role: BoardRole; size?: ChipProps['size'] }> = ({ role, size = 'sm' }) => {
  const { t } = useLocale()
  const { item, color } = ROLE_STYLE[role]
  return (
    <Chip variant='soft' color={color} size={size}>
      <Chip.Label>{t(item)}</Chip.Label>
    </Chip>
  )
}

/**
 * 優先度を色だけで示す 1px の水平線 2 本。カード上端に幅 90% で中央寄せして置く想定。
 * 同じ情報を PriorityChip がテキストで持つため、支援技術からは隠す。
 */
export const PriorityBar: FC<{ priority: TicketPriority; className?: string }> = ({ priority, className }) => (
  <div aria-hidden className={priorityStyles({ priority }).bar({ className })} />
)

/**
 * PriorityBar を載せる箱の枠線。ダークは背景と周囲のコントラストが弱いので、
 * バーと同じ色で全周に枠を出して輪郭を作る(ライトは影で十分に浮くため透明のまま)。
 */
export const priorityBorderClass = (priority: TicketPriority) => priorityStyles({ priority }).border()

/**
 * PriorityBar を載せる箱の背景色。バー / 枠と同じ色を 10% で敷き、下地を透かして淡く色を付ける。
 * 半透明なので単色の背景クラス(bg-sky-50 など)とは併用できない(後勝ちで打ち消し合う)。
 */
export const priorityBgClass = (priority: TicketPriority) => priorityStyles({ priority }).bg()

/**
 * カードの最背面に敷く不透明な下地。
 * priorityBgClass / statusBgClass はどちらも半透明なので、下地が無いとカードの色が
 * レーン(ステータス色)と混色されてしまう。
 * 背景色の指定同士が打ち消し合わないよう、priorityBgClass とは別の要素に当てること。
 */
export const CARD_BACKDROP_CLASS = 'bg-white dark:bg-black'

/**
 * タグの表示色。HeroUI Chip は色を 5 種しか持たないため Tailwind の utility で上書きする。
 *
 * ビルド出力でレイヤーの初出順が properties < theme < base < components < utilities であることを
 * 確認済み。HeroUI の .chip は @layer components にあるので `!` なしで後勝ちする
 * (崩れた場合は bg-red-200! のように `!` を付ける。globals.css に前例あり)。
 *
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(bg-${color}-200 のような合成は不可)。
 */
const tagStyles = tv({
  variants: {
    color: {
      gray: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
      red: 'bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100',
      orange: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-100',
      amber: 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
      green: 'bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100',
      teal: 'bg-teal-200 text-teal-900 dark:bg-teal-900 dark:text-teal-100',
      blue: 'bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
      indigo: 'bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-100',
      violet: 'bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
      pink: 'bg-pink-200 text-pink-900 dark:bg-pink-900 dark:text-pink-100',
    } satisfies Record<TagColor, string>,
  },
})

/**
 * チケットの表示ID(`KEY-番号`)。値はサーバー側で組み立てたものをそのまま出す。
 * 桁の違いで揃わなくならないよう等幅で、本文より一段弱い色にして件名を主役に保つ。
 */
export const TicketIdText: FC<{ displayId: string; className?: string }> = ({ displayId, className }) => (
  <span className={cn('font-mono text-xs text-gray-500', className)}>{displayId}</span>
)

/** タグ色のクラス。className を渡すと tailwind-merge でマージされる */
export const tagColorClass = (color: TagColor, className?: string) => tagStyles({ color, className })

/** タグ 1 件ぶんの Chip。色は tagStyles で当てる */
export const TagChip: FC<{
  tag: { name: string; color: TagColor }
  size?: ChipProps['size']
  className?: string
  /** クリックで選択させる場合に渡す(Chip は role / onClick を透過する) */
  onClick?: () => void
  /** ラベルの後ろに置く要素(× ボタンなど) */
  children?: ReactNode
}> = ({ tag, size = 'sm', className, onClick, children }) => (
  <Chip
    variant='tertiary'
    size={size}
    className={tagColorClass(tag.color, className)}
    {...(onClick ? { role: 'button', onClick } : {})}
  >
    <Chip.Label>{tag.name}</Chip.Label>
    {children}
  </Chip>
)

export const TagChips: FC<{ tags: { id: string; name: string; color: TagColor }[]; size?: ChipProps['size'] }> = ({
  tags,
  size = 'sm',
}) => {
  if (tags.length === 0) {
    return null
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {tags.map((tag) => (
        <TagChip key={tag.id} tag={tag} size={size} />
      ))}
    </div>
  )
}

/**
 * ボードの表示名を解決する。
 * プライベートボードは DB 上の name が固定値(PRIVATE_BOARD_NAME)なので、
 * ユーザーの言語設定に追従させるためロケールへ差し替える。
 */
export const useBoardName = () => {
  const { t } = useLocale()
  return useCallback(
    (board: { name: string; kind: BoardKind }) => (board.kind === 'private' ? t('private') : board.name),
    [t],
  )
}

/** ステータス / 優先度の選択肢(Record<id, label>)。SingleSelectCtrl へ渡す */
export const useTicketOptions = () => {
  const { t } = useLocale()
  return {
    statusOptions: Object.fromEntries(
      (Object.keys(STATUS_STYLE) as TicketStatus[]).map((status) => [status, t(STATUS_STYLE[status].item)]),
    ),
    priorityOptions: Object.fromEntries(
      (Object.keys(PRIORITY_META) as TicketPriority[]).map((priority) => [priority, t(PRIORITY_META[priority].item)]),
    ),
  }
}

/** ボードロールの選択肢(Record<id, label>)。RoleChip と同じ文言を SingleSelectCtrl へ渡す */
export const useRoleOptions = (): Record<BoardRole, string> => {
  const { t } = useLocale()
  return { owner: t(ROLE_STYLE.owner.item), member: t(ROLE_STYLE.member.item) }
}
