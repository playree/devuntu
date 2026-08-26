'use client'

import { Avatar } from '@heroui/react'
import { FC } from 'react'
import { tv } from 'tailwind-variants'

/**
 * xs(16px) は HeroUI に無いサイズなので utility で作る。
 * .avatar は @layer components なので @layer utilities の size-* / rounded-* / text-* が勝つ。
 * クラス名は purge 対策で必ず完全なリテラルで書くこと。
 */
const avatarStyles = tv({
  slots: { base: '', fallback: '' },
  variants: {
    size: {
      // 頭文字が画像アバターに見劣りしないよう円径の 2/3 程度にする。既定の行高(20px)は 16px の円から
      // はみ出すので /none で潰す(.avatar__fallback の line-height は --tw-leading を見ている)
      xs: { base: 'size-4 rounded-full', fallback: 'text-[11px]/none' },
      sm: {},
      md: {},
    },
  },
})

/** エージェントユーザー専用のアバター画像 */
const AGENT_AVATAR_SRC = '/agent/agent-user.png'

type UserAvatarProps = {
  name: string
  image?: string | null
  /** trueの場合、imageの値に関わらずエージェント専用アイコンを表示する */
  isAgent?: boolean
  /** xs=16px(かんばんカード / 選択肢) / sm=32px / md=40px */
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

/**
 * ユーザーのアバター。画像が無い / 読み込めない場合は名前の頭文字を出す。
 * 名前も無い場合は '?' にする。
 */
export const UserAvatar: FC<UserAvatarProps> = ({ name, image, isAgent, size = 'md', className }) => {
  const styles = avatarStyles({ size })
  return (
    <Avatar // xs は HeroUI のサイズ指定を持たないので既定(md)のまま utility で潰す
      size={size === 'xs' ? undefined : size}
      className={styles.base({ className })}
    >
      <Avatar.Image src={isAgent ? AGENT_AVATAR_SRC : (image ?? '')} />
      <Avatar.Fallback className={styles.fallback()}>{name.charAt(0) || '?'}</Avatar.Fallback>
    </Avatar>
  )
}
