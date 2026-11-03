'use client'

import { FlexCol } from '@/components/general/flex'
import { DialogModal } from '@/components/general/modal'
import { PaperClipIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { formatFileSize } from '@/lib/storage/upload'
import { useLocale } from '@/locale/client'
import { activeEditor$, ButtonWithTooltip, insertMarkdown$, useCellValues, usePublisher } from '@mdxeditor/editor'
import { $getRoot, $getSelection, $setSelection, BaseSelection } from 'lexical'
import { createContext, FC, ReactNode, useContext, useRef, useState } from 'react'
import { FileDropzone, uploadDialogStyles } from './file-dropzone'
import { useMdxPopupContainer } from './mdx-popup-container'
import { useMaxFileSizeMb } from './upload-limit'

type FileUploadHandler = (file: File) => Promise<string>

/**
 * ファイルのアップロード処理。添付先ボードはエディタ側(mdx-editor-core.tsx)が ref で最新値を持つので、
 * ツールバーへは処理ごと context で渡す
 */
const FileUploadContext = createContext<FileUploadHandler | null>(null)

export const FileUploadProvider: FC<{ handler: FileUploadHandler; children: ReactNode }> = ({ handler, children }) => (
  <FileUploadContext.Provider value={handler}>{children}</FileUploadContext.Provider>
)

/** リンクのテキストで Markdown として解釈される文字(強調・コード・HTML・リンクの括弧)を退避する */
const escapeLinkText = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1')

/**
 * ツールバーの「ファイルを添付」。選んだファイルをアップロードし、カーソル位置へ
 * `[ファイル名](/api/upload/<key>)` のリンクを挿入する。
 *
 * ダイアログへフォーカスが移るとエディタの選択位置が使えなくなるため、開いた時点の選択を控えておき、
 * 挿入の直前に戻す。選択が無ければ末尾へ挿入する。
 */
export const InsertFile: FC = () => {
  const { t } = useLocale()
  const upload = useContext(FileUploadContext)
  const maxSizeMb = useMaxFileSizeMb()
  const [activeEditor] = useCellValues(activeEditor$)
  const insertMarkdown = usePublisher(insertMarkdown$)
  const popupContainer = useMdxPopupContainer()

  const [isOpen, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>()
  const [isPending, setPending] = useState(false)
  const selectionRef = useRef<BaseSelection | null>(null)

  const open = () => {
    selectionRef.current = activeEditor?.getEditorState().read(() => $getSelection()?.clone() ?? null) ?? null
    setFile(null)
    setError(undefined)
    setPending(false)
    setOpen(true)
  }

  // サイズはサーバー側でも弾かれるが、アップロードする前に気付けるようここでも見る
  const select = (selected: File | undefined) => {
    if (!selected) {
      return
    }
    if (selected.size > maxSizeMb * 1024 * 1024) {
      // 弾いたときに前回の選択を残すと、エラーを出しながら古いファイルを送ってしまう
      setError(t('@invalid_file_size', { max: maxSizeMb }))
      setFile(null)
      return
    }
    setError(undefined)
    setFile(selected)
  }

  const submit = async () => {
    if (!file || !upload) {
      return
    }
    setPending(true)
    try {
      const url = await upload(file)
      activeEditor?.update(() => {
        const saved = selectionRef.current
        if (saved) {
          $setSelection(saved.clone())
        } else if (!$getSelection()) {
          $getRoot().selectEnd()
        }
      })
      insertMarkdown(`[${escapeLinkText(file.name)}](${url})`)
      setOpen(false)
      // react-aria が閉じたあとトリガーへフォーカスを戻すので、次のフレームでエディタへ戻す
      requestAnimationFrame(() => activeEditor?.focus())
    } catch (e) {
      notify.error(t('msg_file_upload_failed'), { description: e instanceof Error ? e.message : undefined })
    } finally {
      setPending(false)
    }
  }

  const styles = uploadDialogStyles()
  return (
    <>
      <ButtonWithTooltip title={t('attach_file')} aria-label={t('attach_file')} onClick={open}>
        <PaperClipIcon width={22} />
      </ButtonWithTooltip>
      <DialogModal
        state={{
          isOpen,
          setOpen: (value) => {
            if (!value && !isPending) {
              setOpen(false)
            }
          },
        }}
        title={{ text: t('attach_file'), icon: <PaperClipIcon /> }}
        isPending={isPending}
        isDismissable
        // 外側の HeroUI Modal の中でも操作できるよう、画像ダイアログと同じ描画先にする(mdx-image-dialog.tsx)
        portalContainer={popupContainer ?? undefined}
        submit={{
          label: t('attach_file'),
          icon: <PaperClipIcon />,
          isPending,
          isDisabled: !file,
          onPress: submit,
          onCancel: () => setOpen(false),
        }}
      >
        <FlexCol>
          <FileDropzone onSelect={select} aria-label={t('select_file')}>
            <PaperClipIcon width={40} className='text-muted' />
            <span className={styles.hint()}>{t('msg_drop_file', { max: maxSizeMb })}</span>
          </FileDropzone>
          <div className={styles.fileName()}>
            {file ? `${file.name} (${formatFileSize(file.size)})` : t('no_file_selected')}
          </div>
          {error && <div className={styles.error()}>{error}</div>}
        </FlexCol>
      </DialogModal>
    </>
  )
}
