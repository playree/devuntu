'use client'

import { MultiButton } from '@/components/general/button'
import { InputField } from '@/components/general/input'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@/components/icon'
import { useLocale } from '@/locale/client'
import {
  activeEditor$,
  cancelLinkEdit$,
  linkDialogState$,
  onWindowChange$,
  removeLink$,
  switchFromPreviewToLinkEdit$,
  updateLink$,
  useCellValues,
  usePublisher,
} from '@mdxeditor/editor'
import { FC, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tv } from 'tailwind-variants'
import { useMdxPopupContainer } from './mdx-popup-container'

/** リンクの矩形とパネルの間隔、および画面端との余白 */
const GAP = 6

/** Panel(variant='shadow')と同じサーフェスにする */
const panelStyles = tv({
  slots: {
    base: 'fixed z-10 w-max max-w-[min(90vw,24rem)] rounded-xl bg-stone-100 p-2 shadow-md dark:border-t-2 dark:border-mist-900 dark:bg-mist-950',
    preview: 'flex items-center gap-1',
    url: 'text-accent mr-1 flex min-w-0 items-center gap-1 text-sm',
    form: 'flex flex-col gap-1',
    formFooter: 'flex justify-end gap-2',
  },
})

/**
 * リンクの編集フォーム。
 *
 * `<form>` は使わない。エディタは HeroUI Modal(チケット編集)の中でも使われ、
 * このパネルは Portal で DOM 上は外へ出ていても React ツリー上はモーダルの `<form>` の子孫なので、
 * submit が合成イベントとして親まで伝播してチケットが保存されてしまう。
 *
 * 初期値は props で受け取り、編集開始のたびに `key` で作り直す前提。
 */
const LinkEditForm: FC<{
  initialUrl: string
  initialText: string
  title: string
  withAnchorText: boolean
  onCancel: () => void
}> = ({ initialUrl, initialText, title, withAnchorText, onCancel }) => {
  const { t } = useLocale()
  const updateLink = usePublisher(updateLink$)
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState(initialText)
  const formRef = useRef<HTMLDivElement>(null)

  /**
   * URL 欄にフォーカスを移す。
   *
   * `autoFocus` は HeroUI(react-aria)の Input が DOM へ渡さず、`ref` も内部の
   * TextField 側に取られて DOM 要素まで届かないため、描画した要素から引く。
   * フォーカスがエディタに残ったままだと、そのまま打ち始められないうえ、
   * 下の Escape / Enter の処理も効かない。
   */
  useEffect(() => {
    formRef.current?.querySelector('input')?.focus()
  }, [])

  const styles = panelStyles()
  const save = () => updateLink({ url, text, title })

  return (
    <div
      ref={formRef}
      className={styles.form()}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') {
          // 素通しするとエディタを内包する HeroUI Modal(チケット編集)ごと閉じて入力が失われる
          e.preventDefault()
          e.stopPropagation()
          onCancel()
          return
        }
        // IME の変換確定を保存と取り違えない
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          /**
           * 既定動作を止めないと、保存でフォーカスがエディタへ戻った直後に同じ打鍵の続きが
           * 本文へ届き、選択中だったテキストが改行で置き換えられてしまう
           */
          e.preventDefault()
          e.stopPropagation()
          save()
        }
      }}
    >
      <InputField isSmart label={t('url')} value={url} onChange={(e) => setUrl(e.target.value)} />
      {withAnchorText && (
        <InputField isSmart label={t('link_text')} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <div className={styles.formFooter()}>
        <MultiButton size='sm' variant='ghost' onPress={onCancel}>
          {t('cancel')}
        </MultiButton>
        <MultiButton size='sm' onPress={save}>
          {t('save')}
        </MultiButton>
      </div>
    </div>
  )
}

/**
 * リンクのプレビューと編集。`linkDialogPlugin` の `LinkDialog` に渡して既定の実装と入れ替える。
 *
 * 既定の実装は Radix Popover だが、位置決めに必要な矩形は `linkDialogState$` が持っているので、
 * 素の fixed 配置で足りる。描画先は MDXEditor のポップアップ用コンテナに限る:
 * 矩形は「transform / filter / backdrop-filter を持つ最も近い祖先」を基準に補正されており
 * (モーダル内では `Modal.Backdrop` の `backdrop-blur`)、別の場所へ出すとその分ずれる。
 */
export const MdxLinkDialog: FC = () => {
  const { t } = useLocale()
  const [linkDialogState, activeEditor] = useCellValues(linkDialogState$, activeEditor$)
  const popupContainer = useMdxPopupContainer()
  const publishWindowChange = usePublisher(onWindowChange$)
  const cancelLinkEdit = usePublisher(cancelLinkEdit$)
  const switchToEdit = usePublisher(switchFromPreviewToLinkEdit$)
  const removeLink = usePublisher(removeLink$)

  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>()
  const [isCopied, setCopied] = useState(false)

  const { type, rectangle } = linkDialogState
  const isPreview = type === 'preview'

  /**
   * スクロールとリサイズで矩形を取り直させる。
   *
   * capture で拾うのは、実際にスクロールするのがエディタ自身(`.mdxeditor` は max-h + overflow)や
   * `Modal.Body` で、window の scroll イベントには上がってこないため。
   * 編集中は矩形の再計算がプレビュー表示への差し戻しになって入力が消えるので、プレビュー中だけ購読する。
   */
  useEffect(() => {
    if (!isPreview) {
      return
    }
    const update = () => activeEditor?.getEditorState().read(() => publishWindowChange(true))
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [isPreview, activeEditor, publishWindowChange])

  /**
   * 表示位置は Popover を使わないぶん自前で見る。
   * rectangle は毎回新しいオブジェクトになるため、数値へばらしてから依存配列に入れること
   * (そのまま渡すと再計算 → 再レンダリングが止まらない)。
   */
  const rectTop = rectangle?.top
  const rectLeft = rectangle?.left
  const rectHeight = rectangle?.height
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || rectTop === undefined || rectLeft === undefined || rectHeight === undefined) {
      setPosition(undefined)
      return
    }
    const { width, height } = panel.getBoundingClientRect()
    const below = rectTop + rectHeight + GAP
    const above = rectTop - height - GAP
    setPosition({
      top: below + height <= window.innerHeight || above < 0 ? below : above,
      left: Math.max(GAP, Math.min(rectLeft, window.innerWidth - width - GAP)),
    })
  }, [rectTop, rectLeft, rectHeight, type])

  useEffect(() => {
    if (!isCopied) {
      return
    }
    const id = setTimeout(() => setCopied(false), 1000)
    return () => clearTimeout(id)
  }, [isCopied])

  if (linkDialogState.type === 'inactive' || !popupContainer) {
    return null
  }

  const styles = panelStyles()
  return createPortal(
    <div
      ref={panelRef}
      role='dialog' // ロールが無いと aria-label が読み上げられない。背後も操作できるので aria-modal は付けない
      aria-label={t('url')}
      className={styles.base()}
      /**
       * 実寸を測るまでは位置が決まらないので、ちらつかないよう透明にしておく。
       * `visibility: hidden` にすると、位置が決まる前に走る URL 欄の focus() が無視される
       */
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, opacity: position ? undefined : 0 }}
    >
      {linkDialogState.type === 'preview' ? (
        <div className={styles.preview()}>
          <a
            href={linkDialogState.href ?? 'about:blank'}
            /**
             * href は Lexical の sanitizeUrl を通っていて `javascript:` などは about:blank に
             * 落ちているため、そのまま開いてよい
             */
            {...(linkDialogState.url.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
            title={linkDialogState.url}
            className={styles.url()}
          >
            <span className='truncate'>{linkDialogState.url}</span>
            {linkDialogState.url.startsWith('http') && <ArrowTopRightOnSquareIcon width={14} />}
          </a>
          <MultiButton size='sm' variant='ghost' isIconOnly tooltip={t('edit_link')} onPress={() => switchToEdit()}>
            <PencilSquareIcon width={16} />
          </MultiButton>
          <MultiButton
            size='sm'
            variant='ghost'
            isIconOnly
            tooltip={t('copy')}
            onPress={() => void window.navigator.clipboard.writeText(linkDialogState.url).then(() => setCopied(true))}
          >
            {isCopied ? (
              <ClipboardDocumentCheckIcon width={16} className='text-success' />
            ) : (
              <ClipboardDocumentIcon width={16} />
            )}
          </MultiButton>
          <MultiButton
            size='sm'
            variant='danger-soft'
            isIconOnly
            tooltip={t('remove_link')}
            onPress={() => removeLink()}
          >
            <XMarkIcon width={16} />
          </MultiButton>
        </div>
      ) : (
        <LinkEditForm
          // 編集を開き直したら入力を作り直す
          key={`${linkDialogState.linkNodeKey}:${linkDialogState.initialUrl}`}
          initialUrl={linkDialogState.url}
          initialText={linkDialogState.text}
          title={linkDialogState.title}
          withAnchorText={linkDialogState.withAnchorText}
          onCancel={() => cancelLinkEdit()}
        />
      )}
    </div>,
    popupContainer,
  )
}
