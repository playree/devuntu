'use client'

import { MultiButton } from '@/components/general/button'
import { PencilSquareIcon, TrashIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { activeEditor$, openEditImageDialog$, useCellValues, usePublisher } from '@mdxeditor/editor'
import { $getNodeByKey } from 'lexical'
import { FC } from 'react'
import { tv } from 'tailwind-variants'

/** `EditImageToolbarProps` は型として export されていないため、`ImageEditor` の呼び出しに合わせて定義する */
type MdxEditImageToolbarProps = {
  nodeKey: string
  imageSource: string
  initialImagePath: string | null
  title: string
  alt: string
  width?: number | 'inherit'
  height?: number | 'inherit'
}

/** 画像の右上に重ねる。位置は MDXEditor 側の `imageWrapper`(position: relative)が基準 */
const toolbarStyles = tv({
  base: 'absolute top-0 right-0 z-10 flex gap-1 rounded-bl-xl bg-stone-100/90 p-1 dark:bg-mist-950/90',
})

/**
 * 本文中の画像に重ねる操作ボタン。`imagePlugin` の `EditImageToolbar` に渡して既定の実装と入れ替える。
 *
 * 既定の実装は CSS Modules のアイコンボタンなので、アプリの {@link MultiButton} に置き換える。
 * 表示専用のエディタでは `ImageEditor` が `readOnly` のときにそもそも描画しないため、ここでの分岐は不要。
 */
export const MdxEditImageToolbar: FC<MdxEditImageToolbarProps> = ({
  nodeKey,
  imageSource,
  initialImagePath,
  title,
  alt,
  width,
  height,
}) => {
  const { t } = useLocale()
  const [activeEditor] = useCellValues(activeEditor$)
  const openEditImageDialog = usePublisher(openEditImageDialog$)

  return (
    <div className={toolbarStyles()}>
      <MultiButton
        size='sm'
        variant='ghost'
        isIconOnly
        tooltip={t('replace_image')}
        onPress={() =>
          openEditImageDialog({
            nodeKey,
            initialValues: {
              src: initialImagePath ?? imageSource,
              title,
              altText: alt,
              // allowSetImageDimensions が false なので使われない。'inherit' は数値ではないので落とす
              width: typeof width === 'number' ? width : undefined,
              height: typeof height === 'number' ? height : undefined,
            },
          })
        }
      >
        <PencilSquareIcon width={16} />
      </MultiButton>
      <MultiButton
        size='sm'
        variant='danger-soft'
        isIconOnly
        tooltip={t('delete_image')}
        onPress={() => activeEditor?.update(() => $getNodeByKey(nodeKey)?.remove())}
      >
        <TrashIcon width={16} />
      </MultiButton>
    </div>
  )
}

/**
 * 画像の読み込みが終わるまで出す下地。`imagePlugin` の `imagePlaceholder` に渡す。
 *
 * `ImageEditor` の `<Suspense fallback>` なので、アップロードの進捗ではなく
 * 表示用の画像をプリロードしている間だけ出る。
 */
export const MdxImagePlaceholder = () => <div className='bg-default/20 my-3 h-40 w-64 animate-pulse rounded-xl' />
