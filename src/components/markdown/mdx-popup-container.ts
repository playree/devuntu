'use client'

import { editorRootElementRef$, useCellValue } from '@mdxeditor/editor'
import { useEffect, useState } from 'react'

/**
 * MDXEditor がポップアップ用に作るコンテナ要素(`.mdxeditor-popup-container`)を返す。
 *
 * この要素は `overlayContainer` の直下に作られるため、エディタが HeroUI Modal の中にあるときは
 * モーダルの内側に入る。ダイアログの描画先をここにすると、
 * - react-aria が「モーダルの外側」とみなして inert を付ける対象から外れる
 * - `linkDialogState$` の矩形と同じ包含ブロックに載るので、座標をそのまま使える
 *
 * セルが保持しているのは ref なので、実体は描画後に読み出す。
 */
export const useMdxPopupContainer = () => {
  const editorRootElementRef = useCellValue(editorRootElementRef$)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const element = editorRootElementRef?.current ?? null
    setContainer((prev) => (prev === element ? prev : element))
  }, [editorRootElementRef])

  return container
}
