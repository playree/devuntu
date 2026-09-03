'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, XMarkIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Modal, UseOverlayStateReturn } from '@heroui/react'
import Image from 'next/image'
import { FC, MouseEvent, PointerEvent, useEffect, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'

export type LightboxImage = { src: string; alt: string; width: number; height: number }

/**
 * クリックされた要素が拡大表示できる画像なら、その情報を返す。
 *
 * 表示中の `<img>` は読み込みが済んでいるので、実寸は `naturalWidth` / `naturalHeight` から
 * その場で取れる(`Attachment` はピクセル寸法を持たないが、そもそも参照する必要がない)。
 */
export const findLightboxImage = (e: MouseEvent<HTMLElement>): LightboxImage | undefined => {
  const target = e.target
  // naturalWidth が 0 = 読み込み前か壊れている。実寸が決まらないので開かない
  if (!(target instanceof HTMLImageElement) || !target.naturalWidth) {
    return undefined
  }
  return {
    // 属性値(Markdown に書かれた相対パス)を優先する。絶対 URL は next/image の src に向かない
    src: target.getAttribute('src') || target.currentSrc || target.src,
    alt: target.alt,
    width: target.naturalWidth,
    height: target.naturalHeight,
  }
}

const lightboxStyles = tv({
  slots: {
    dialog: 'bg-transparent p-0 shadow-none',
    toolbar: 'absolute top-2 right-2 z-10 flex items-center gap-1 rounded-xl bg-stone-100/90 p-1 dark:bg-mist-950/90',
    size: 'text-default-500 px-1 font-mono text-xs',
    // 溢れた側が切れないよう、中央寄せは justify/items ではなく画像側の m-auto で行う
    canvas: 'flex min-h-0 flex-1 overscroll-contain outline-none',
    image: 'm-auto',
  },
  variants: {
    isActual: {
      // クラス名は purge 対策で必ず完全なリテラルで書くこと
      true: { canvas: 'overflow-auto', image: 'max-h-none max-w-none cursor-zoom-out' },
      false: { canvas: 'overflow-hidden', image: 'max-h-full max-w-full cursor-zoom-in' },
    },
  },
})

/**
 * Markdown 表示中の画像を全画面で見るライトボックス。
 *
 * `max-w-none` で preflight の `max-width: 100%` を解除すると、`width` / `height` 属性に入れた
 * 実寸がそのまま CSS ピクセルとして描画される。アップロード時に長辺 2000px へ縮小しているので
 * (`src/lib/storage/attachment.ts`)、これが表示できる最大の実寸になる。
 *
 * 開くたびに `key` で作り直される前提なので、表示モードやスクロール位置は保持しない。
 */
export const ImageLightbox: FC<{ state: UseOverlayStateReturn; image?: LightboxImage }> = ({ state, image }) => {
  const { t } = useLocale()
  const [isActual, setActual] = useState(true)
  const canvasRef = useRef<HTMLDivElement>(null)
  // パン操作の終了時に発生する click を、余白クリック(閉じる)と取り違えないためのフラグ
  const movedRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      canvas.scrollLeft = (canvas.scrollWidth - canvas.clientWidth) / 2
      canvas.scrollTop = (canvas.scrollHeight - canvas.clientHeight) / 2
      // 矢印キーや PageDown でスクロールできるようにする
      canvas.focus()
    }
  }, [isActual])

  if (!image) {
    return null
  }

  // 実寸が画面に収まる画像では両モードが同じ見た目になり、押しても何も起きないボタンになる
  const canToggle = image.width > window.innerWidth || image.height > window.innerHeight

  /** ホイールが縦しか効かないデスクトップ向けのパン。タッチはネイティブスクロールに任せる */
  const startPan = (e: PointerEvent<HTMLDivElement>) => {
    if (!isActual || e.pointerType === 'touch' || e.button !== 0) {
      return
    }
    const canvas = e.currentTarget
    const start = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop }
    movedRef.current = false
    canvas.setPointerCapture(e.pointerId)

    const move = (moveEvent: globalThis.PointerEvent) => {
      canvas.scrollLeft = start.left - (moveEvent.clientX - start.x)
      canvas.scrollTop = start.top - (moveEvent.clientY - start.y)
      movedRef.current = true
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', () => canvas.removeEventListener('pointermove', move), { once: true })
  }

  /** size='full' の Dialog が全面を覆って backdrop の outside-press が届かないため、余白で閉じる */
  const closeOnCanvas = (e: MouseEvent<HTMLDivElement>) => {
    const wasMoved = movedRef.current
    movedRef.current = false
    if (e.target === e.currentTarget && !wasMoved) {
      state.close()
    }
  }

  const styles = lightboxStyles({ isActual })
  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen}>
      <Modal.Container size='full'>
        <Modal.Dialog
          aria-label={t('preview')} // Modal.Heading を置かないので読み上げ名を明示する
          className={styles.dialog()}
        >
          <div className={styles.toolbar()}>
            <span className={styles.size()}>
              {image.width} × {image.height}
            </span>
            {canToggle && (
              <MultiButton
                variant='ghost'
                size='sm'
                isIconOnly
                tooltip={t(isActual ? 'image_fit_screen' : 'image_actual_size')}
                icon={isActual ? <ArrowsPointingInIcon width={16} /> : <ArrowsPointingOutIcon width={16} />}
                onPress={() => setActual((prev) => !prev)}
              />
            )}
            <MultiButton
              variant='ghost'
              size='sm'
              isIconOnly
              tooltip={t('close')}
              icon={<XMarkIcon width={16} />}
              onPress={state.close}
            />
          </div>
          <div
            ref={canvasRef}
            tabIndex={-1}
            className={styles.canvas()}
            onPointerDown={startPan}
            onClick={closeOnCanvas}
          >
            <Image
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              /**
               * 最適化 API はサーバー側から Cookie 無しで取り直すため、
               * ログイン必須の /api/upload では 401 になる
               */
              unoptimized
              draggable={false}
              className={styles.image()}
              onClick={() => setActual((prev) => !prev)}
            />
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
