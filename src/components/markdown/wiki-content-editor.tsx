import type { WikiPageType } from '@/generated/prisma/enums'
import { MAX_WIKI_CONTENT } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { FC, ReactNode } from 'react'
import { DesignDocEditor } from './design-doc-editor'
import { MarkdownField } from './markdown-editor'

export const WikiContentEditor: FC<{
  type: WikiPageType
  initialValue: string
  onChange: (markdown: string) => void
  documentId: string
  length: number
  spaceId: string
  isLabelHidden?: boolean
  info?: ReactNode
  minRows: number
  onUploadingChange: (isUploading: boolean) => void
  footer?: ReactNode
}> = ({ type, initialValue, documentId, spaceId, minRows, onUploadingChange, ...props }) => {
  const { t } = useLocale()
  const common = {
    ...props,
    label: t('content'),
    maxLength: MAX_WIKI_CONTENT,
    allowImages: true,
    uploadOwner: { kind: 'wikiSpace' as const, wikiSpaceId: spaceId },
  }

  return type === 'design_doc' ? (
    <DesignDocEditor
      {...common}
      initialValue={initialValue}
      documentId={documentId}
      onUploadingChange={onUploadingChange}
    />
  ) : (
    <MarkdownField {...common} body={initialValue} isEditing defaultValue={initialValue} minRows={minRows} />
  )
}
