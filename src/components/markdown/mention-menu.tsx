'use client'

import { UserAvatar } from '@/components/general/avatar'
import { FC, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'
import { MentionUser } from './mention-node'

/** メンション候補。`getAssigneeOptions` が返す形と構造的に一致させる */
export type MentionCandidate = MentionUser & {
  id: string
}

/** 描画に必要な情報だけに落とした候補({@link MentionMenu} を Lexical から独立させるため) */
export type MentionMenuItem = MentionCandidate & {
  /** キー操作でのスクロール追従用に、Lexical へ項目の要素を渡す */
  setElement: (element: HTMLElement | null) => void
}

/**
 * Panel(variant='shadow')と同じサーフェスにする。
 *
 * 枠は Lexical が用意する外側の div(position: absolute)に対して absolute で重ねる。
 * その div はキャレットの矩形と同じ幅まで縮むため、通常フローに置くと一覧が潰れる。
 */
const menuStyles = tv({
  slots: {
    base: 'absolute top-0 left-0 z-9999 max-h-64 w-max min-w-40 overflow-y-auto rounded-xl bg-stone-100 p-1 shadow-md dark:border-t-2 dark:border-mist-900 dark:bg-mist-950',
    item: 'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm',
    email: 'truncate font-mono text-xs text-gray-500',
  },
  variants: {
    isSelected: {
      // クラス名は purge 対策で必ず完全なリテラルで書くこと
      true: { item: 'bg-stone-200 dark:bg-mist-900' },
    },
  },
})

/**
 * メンション候補の一覧。
 *
 * HeroUI の Popover / ListBox は使わない。react-aria のフォーカス管理が
 * contenteditable からフォーカスを奪ってしまうため、フォーカスは一切動かさず、
 * キー操作は Lexical のコマンド経由で処理する素のリストにする。
 */
export const MentionMenu: FC<{
  /** Lexical がキャレット位置に合わせて動かすコンテナ。描画先 */
  anchor: HTMLElement | null
  items: MentionMenuItem[]
  /** キー操作で選択中の位置。未選択なら null */
  selectedIndex: number | null
  onSelect: (index: number) => void
  onHighlight: (index: number) => void
}> = ({ anchor, items, selectedIndex, onSelect, onHighlight }) => {
  /**
   * HeroUI Modal(react-aria)はモーダル外にあたる body 直下の要素すべてに inert を付ける。
   * Lexical は枠を body 直下へ挿すため、モーダル内のエディタで開いたメニューは
   * 表示はされるのにクリックできなくなる(inert は描画を止めず操作だけ止める)。
   * 枠は実際にはモーダル内のエディタの一部なので inert を外す。
   *
   * 別のオーバーレイが開くと react-aria が付け直すため、依存配列は付けず描画ごとに外す。
   */
  useEffect(() => {
    anchor?.removeAttribute('inert')
  })

  if (!anchor || items.length === 0) {
    return null
  }

  const styles = menuStyles()
  return createPortal(
    <ul // anchor 側が role='listbox' を持つので、option の親子関係を崩さないよう ul は透過させる
      role='presentation'
      className={styles.base()}
    >
      {items.map(({ id, name, email, image, setElement }, index) => (
        <li
          key={id}
          ref={setElement}
          /**
           * id は Lexical が aria-activedescendant に設定する値と合わせる。
           * ずれると読み上げが選択位置を追えない
           */
          id={`typeahead-item-${index}`}
          role='option'
          aria-selected={index === selectedIndex}
          className={styles.item({ isSelected: index === selectedIndex })}
          onMouseDown={(e) => e.preventDefault()} // エディタを blur させない(blur するとメニューが閉じる)
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onSelect(index)}
        >
          <UserAvatar name={name} image={image} size='xs' />
          <div className='min-w-0'>
            <div className='truncate'>{name}</div>
            {/* 同名のメンバーを見分けられるようにする(絞り込みにも使える) */}
            <div className={styles.email()}>{email}</div>
          </div>
        </li>
      ))}
    </ul>,
    anchor,
  )
}
