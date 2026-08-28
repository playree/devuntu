'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { PhotoIcon } from '@/components/icon'
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '@/lib/schema/schema'
import { useLocale } from '@/locale/client'
import { Modal } from '@heroui/react'
import {
  activeEditor$,
  closeImageDialog$,
  imageDialogState$,
  imageUploadHandler$,
  saveImage$,
  useCellValues,
  usePublisher,
} from '@mdxeditor/editor'
import Image from 'next/image'
import { FC, useEffect, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'
import { useMdxPopupContainer } from './mdx-popup-container'

const dialogStyles = tv({
  slots: {
    dropzone:
      'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors',
    preview: 'max-h-56 w-auto object-contain',
    hint: 'text-default-500 text-sm',
    fileName: 'text-default-500 truncate text-sm',
    error: 'text-danger text-sm',
  },
  variants: {
    isDragOver: {
      // クラス名は purge 対策で必ず完全なリテラルで書くこと
      true: { dropzone: 'border-accent bg-accent/10' },
      false: { dropzone: 'border-mist-200 dark:border-mist-900' },
    },
  },
})

/**
 * 画像の挿入 / 差し替えダイアログ。`imagePlugin` の `ImageDialog` に渡して既定の実装と入れ替える。
 *
 * 既定の実装は素の `<input>` を並べた Radix Dialog で、URL 入力と alt / title も持つ。
 * ここではファイル選択(クリック / ドラッグ&ドロップ)とプレビューだけに絞り、
 * 見た目はアプリの他のモーダルに揃える。
 *
 * `imagePlugin` の引数はマウント後に差し替えられないため、モジュールの定数として定義して
 * 呼び元({@link ../markdown/mdx-editor-core})の `plugins` の参照を変えないこと。
 */
export const MdxImageDialog: FC = () => {
  const { t } = useLocale()
  const [dialogState, uploadHandler, activeEditor] = useCellValues(
    imageDialogState$,
    imageUploadHandler$,
    activeEditor$,
  )
  const popupContainer = useMdxPopupContainer()
  const saveImage = usePublisher(saveImage$)
  const closeImageDialog = usePublisher(closeImageDialog$)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [isPending, setPending] = useState(false)
  const [isDragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isOpen = dialogState.type !== 'inactive'

  // レンダリング中に開閉の変化を見て同期する(useEffect だと一度古い選択が見えてしまう)
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    setFile(null)
    setPreview(null)
    setError(undefined)
    setPending(false)
    setDragOver(false)
  }

  useEffect(() => {
    if (!preview) {
      return
    }
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  /**
   * 閉じたらエディタへフォーカスを戻す。
   *
   * react-aria はアンマウント時にトリガー(ツールバーのボタン)へフォーカスを戻すため、
   * 同期で呼ぶと上書きされる。次のフレームまで待ってから動かす。
   */
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current) {
      return
    }
    wasOpenRef.current = false
    const id = requestAnimationFrame(() => activeEditor?.focus())
    return () => cancelAnimationFrame(id)
  }, [isOpen, activeEditor])

  // 形式とサイズはサーバー側でも弾かれるが、アップロードする前に気付けるようここでも見る
  const select = (selected: File | undefined) => {
    if (!selected) {
      return
    }
    // 弾いたときに前回の選択を残すと、エラーを出しながら古いファイルを送ってしまう
    const reject = (message: string) => {
      setError(message)
      setFile(null)
      setPreview(null)
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) {
      reject(t('@invalid_image_type'))
      return
    }
    if (selected.size > MAX_IMAGE_SIZE) {
      reject(t('@invalid_image_size'))
      return
    }
    setError(undefined)
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
  }

  const submit = async () => {
    if (!file || !uploadHandler) {
      return
    }
    setPending(true)
    try {
      const src = await uploadHandler(file)
      /**
       * alt / title の入力欄は出さないので、差し替えのときは既存値をそのまま持ち越す。
       * `saveImage$` の差し替え分岐は渡された値を無条件に書き込むため、省くと消えてしまう
       */
      const initial = dialogState.type === 'editing' ? dialogState.initialValues : undefined
      saveImage({ src, altText: initial?.altText ?? '', title: initial?.title ?? '' })
    } catch {
      // 失敗の通知は imageUploadHandler(mdx-editor-core.tsx)が Toast で出す
      setPending(false)
    }
  }

  const isEditing = dialogState.type === 'editing'
  const styles = dialogStyles()
  return (
    <Modal.Backdrop
      variant='blur'
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isPending) {
          closeImageDialog()
        }
      }}
      // アップロード中に閉じると、完了時の反映先が失われて新規挿入として扱われてしまう
      isDismissable={!isPending}
      isKeyboardDismissDisabled={isPending}
      /**
       * 既定の描画先(body 直下)にすると、外側の HeroUI Modal(チケット追加など)が
       * react-aria の ariaHideOutside で「後から body 直下に増えた要素」に inert を付けるため、
       * ダイアログが見えているのに操作できなくなる
       */
      UNSTABLE_portalContainer={popupContainer ?? undefined}
    >
      <Modal.Container placement='top'>
        <Modal.Dialog>
          <Modal.CloseTrigger isDisabled={isPending} />
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>
              <PhotoIcon />
              {t(isEditing ? 'replace_image' : 'insert_image')}
            </Modal.Heading>
          </Modal.Header>
          {/* チケット編集モーダル内でも使うため form は置かない(submit が外側の form へ伝播する) */}
          <Modal.Body className='pt-2'>
            <FlexCol>
              <button
                type='button'
                aria-label={t('select_file')} // プレビュー表示中は中の文言が消えるので明示する
                onClick={() => inputRef.current?.click()}
                // preventDefault を忘れるとブラウザが既定動作でドロップした画像を開いてしまう
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  select(e.dataTransfer.files[0])
                }}
                className={styles.dropzone({ isDragOver })}
              >
                {preview ? (
                  <Image
                    src={preview}
                    alt=''
                    width={640}
                    height={360}
                    unoptimized // blob URL なので Next.js の最適化は通せない
                    className={styles.preview()}
                  />
                ) : (
                  <>
                    <PhotoIcon width={40} className='text-default-500' />
                    <span className={styles.hint()}>{t('msg_drop_image')}</span>
                  </>
                )}
              </button>
              <input
                ref={inputRef}
                type='file'
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                className='hidden'
                onChange={(e) => select(e.target.files?.[0])}
              />
              <div className={styles.fileName()}>{file?.name ?? t('no_file_selected')}</div>
              {error && <div className={styles.error()}>{error}</div>}
            </FlexCol>
          </Modal.Body>
          <Modal.Footer>
            <MultiButton variant='ghost' isDisabled={isPending} onPress={() => closeImageDialog()}>
              {t('cancel')}
            </MultiButton>
            <MultiButton icon={<PhotoIcon />} isDisabled={!file} isPending={isPending} onPress={submit}>
              {t(isEditing ? 'replace_image' : 'insert_image')}
            </MultiButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
