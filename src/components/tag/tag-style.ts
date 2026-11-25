import type { TagColor } from '@/generated/prisma/enums'
import { tv } from 'tailwind-variants'

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

/** タグ色の小さな印(Wiki のツリーなど、名前を出す幅が無いところ)。Chip より濃い色で背景と見分ける */
const tagDotStyles = tv({
  base: 'inline-block size-2 shrink-0 rounded-full',
  variants: {
    color: {
      gray: 'bg-gray-400',
      red: 'bg-red-500',
      orange: 'bg-orange-500',
      amber: 'bg-amber-500',
      green: 'bg-green-500',
      teal: 'bg-teal-500',
      blue: 'bg-blue-500',
      indigo: 'bg-indigo-500',
      violet: 'bg-violet-500',
      pink: 'bg-pink-500',
    } satisfies Record<TagColor, string>,
  },
})

export const tagDotClass = (color: TagColor, className?: string) => tagDotStyles({ color, className })
