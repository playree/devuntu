/**
 * チケットの表示色(ステータス / 優先度 / タグ)を当てるクラス
 *
 * Chip の表示色(HeroUI のセマンティック名)は `ticket-options.ts` の map にある。
 */

import type { TagColor, TicketPriority, TicketStatus } from '@/generated/prisma/enums'
import { tv } from 'tailwind-variants'

/**
 * ステータスの背景色。StatusChip(STATUS_STYLE)と同じ色を薄く敷き(backlog は 20%、それ以外は 5%)、下地を透かして淡く色を付ける。
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

/** ステータス色を薄く敷いた背景クラス。className を渡すと tailwind-merge でマージされる */
export const statusBgClass = (status: TicketStatus, className?: string) => statusStyles({ status, className })

/**
 * 優先度の配色。水平線(bar)・カード枠線(border)・カード背景(bg)を 1 箇所に集約する。
 * bar は 1px の線で面積が小さいため透過させず、bg は同系色を 10% で敷いて下地を透かす。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと(tagStyles と同じ規約)。
 */
const priorityStyles = tv({
  slots: {
    /**
     * 塗りは持たず、上下のボーダーだけで 1px の水平線 2 本を作る。
     * box-border なので h-1(4px)の内訳が 線 1px / 余白 2px / 線 1px になる。
     * flex 行に置いて ID の右の残り幅を埋める前提なので、左右の余白は呼び出し側が持つ。
     * border スロットと同じ規約で、幅は常に確保して色だけ variants で変える。
     */
    bar: 'h-1 min-w-0 flex-1 border-y border-transparent',
    // テーマ切り替えでレイアウトが動かないよう、枠の幅は常に確保しておく
    border: 'border-x border-b-3 border-transparent',
    bg: '',
  },
  variants: {
    priority: {
      urgent: {
        bar: 'border-red-300/30 dark:border-red-800/30',
        border: 'border-red-300/30 dark:border-red-800/30',
        bg: 'bg-red-300/15 dark:bg-red-800/10',
      },
      high: {
        bar: 'border-amber-400/30 dark:border-amber-500/20',
        border: 'border-amber-400/30 dark:border-amber-500/20',
        bg: 'bg-amber-400/15 dark:bg-amber-500/10',
      },
      medium: {
        bar: 'border-blue-300/30 dark:border-blue-800/30',
        border: 'border-blue-300/30 dark:border-blue-800/30',
        bg: 'bg-blue-300/15 dark:bg-blue-800/10',
      },
      low: {
        bar: 'border-gray-300/30 dark:border-gray-600/30',
        border: 'border-gray-300/30 dark:border-gray-600/30',
        bg: 'bg-gray-300/15 dark:bg-gray-600/10',
      },
    } satisfies Record<TicketPriority, unknown>,
  },
})

/** 優先度の水平線(PriorityBar)のクラス */
export const priorityBarClass = (priority: TicketPriority, className?: string) =>
  priorityStyles({ priority }).bar({ className })

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

/** タグ色のクラス。className を渡すと tailwind-merge でマージされる */
export const tagColorClass = (color: TagColor, className?: string) => tagStyles({ color, className })
