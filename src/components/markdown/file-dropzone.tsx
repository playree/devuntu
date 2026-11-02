'use client'

import { FC, ReactNode, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'

const dropzoneStyles = tv({
  base: 'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors',
  variants: {
    isDragOver: {
      // クラス名は purge 対策で必ず完全なリテラルで書くこと
      true: 'border-accent bg-accent/10',
      false: 'border-mist-200 dark:border-mist-900',
    },
  },
})

/** ドロップゾーンを置くアップロードダイアログ(画像 / ファイル)の共通の見た目 */
export const uploadDialogStyles = tv({
  slots: {
    preview: 'max-h-56 w-auto object-contain',
    hint: 'text-muted text-sm',
    fileName: 'text-muted truncate text-sm',
    error: 'text-danger text-sm',
  },
})

/**
 * クリックまたはドラッグ&ドロップでファイルを1つ選ぶ領域。中身(案内文 / プレビュー)は children で渡す。
 * 選んだファイルの検証は呼び元で行う。
 */
export const FileDropzone: FC<{
  /** `<input type=file>` の accept。省略時はすべての形式 */
  accept?: string
  onSelect: (file: File | undefined) => void
  /** プレビュー表示中は中の文言が消えるので明示する */
  'aria-label': string
  children: ReactNode
}> = ({ accept, onSelect, 'aria-label': ariaLabel, children }) => {
  const [isDragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type='button'
        aria-label={ariaLabel}
        onClick={() => inputRef.current?.click()}
        // preventDefault を忘れるとブラウザが既定動作でドロップしたファイルを開いてしまう
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onSelect(e.dataTransfer.files[0])
        }}
        className={dropzoneStyles({ isDragOver })}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type='file'
        accept={accept}
        className='hidden'
        onChange={(e) => {
          onSelect(e.target.files?.[0])
          // 同じファイルを選び直しても onChange が発火するようにする
          e.target.value = ''
        }}
      />
    </>
  )
}
