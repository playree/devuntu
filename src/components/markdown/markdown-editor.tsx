'use client'

import { EditorField } from '@/components/general/editor-field'
import { getFieldConstraints } from '@/components/general/field-constraints'
import { useLocale } from '@/locale/client'
import { Skeleton } from '@heroui/react'
import dynamic from 'next/dynamic'
import { CSSProperties, FC, memo, ReactNode, useCallback, useMemo, useState } from 'react'
import { Control, FieldPath, FieldValues, useController } from 'react-hook-form'
import { z } from 'zod'
import { MarkdownView } from './markdown-view'
// 型のみの参照。実体(lexical / MDXEditor)は mdx-editor-core 側の動的 import に閉じたままになる
import {
  attachmentOwnerColumns,
  attachmentOwnerOf,
  PUBLIC_ATTACHMENT_OWNER,
  type AttachmentOwner,
} from '@/lib/storage/attachment-owner'
import type { MentionCandidate } from './mention-menu'

/** 枠なし表示用のクラス。実体は globals.css(style.css の padding を上書きするためレイヤー外) */
const FLAT_CLASS = 'mdxeditor-flat'

/**
 * 編集面の既定の最小行数。
 *
 * MDXEditor には `rows` / `minRows` 相当の prop が無いため、行数は CSS 変数
 * `--mdx-min-rows` としてラッパーに置き、globals.css 側で min-height に換算する。
 * rich-text(contenteditable)と source(CodeMirror)の両方に継承で届く。
 */
const DEFAULT_MIN_ROWS = 6

/**
 * ローディング Skeleton も同じ変数で高さを合わせ、マウント時のガタつきを防ぐ。
 * 1 行の高さは globals.css の `.markdown`(text-sm = 0.875rem / leading-normal = 1.5)と手で同期させる。
 */
const MIN_HEIGHT = 'calc(var(--mdx-min-rows, 6) * 1.3125rem)'

// MDXEditor はブラウザ専用なので SSR から外す(lexical / codemirror も別チャンクへ分離される)
const MdxEditorCore = dynamic(() => import('./mdx-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='w-full rounded-xl' style={{ minHeight: MIN_HEIGHT }} />,
})

/**
 * 呼び出し側が描画のたびに作る持ち主を、値が同じ間は同じ参照にする(MdxEditorHost の memo を効かせるため)
 */
const useStableOwner = (owner: AttachmentOwner = PUBLIC_ATTACHMENT_OWNER): AttachmentOwner => {
  const { boardId, wikiSpaceId } = attachmentOwnerColumns(owner)
  return useMemo(() => attachmentOwnerOf({ boardId, wikiSpaceId }), [boardId, wikiSpaceId])
}

/**
 * MDXEditor のマウント位置を確定させるラッパー。
 *
 * MDXEditor は Radix のポップアップを `overlayContainer`(既定は document.body)配下へ出すが、
 * HeroUI Modal は react-aria の focus containment を持つため body だとフォーカスを引き戻され、
 * リンク・テーブル・言語選択の UI が使えない。Modal.Dialog を探して描画先に指定する。
 * Modal.Body ではなく Dialog 直下にするのは、Body が `overflow-y: auto` でクリップするため。
 *
 * props をすべて安定参照にして memo するため、入力のたびに MDXEditor 全体
 * (ツールバー含む)が再レンダリングされない。
 */
const MdxEditorHost = memo<{
  /** 初期 Markdown。マウント後の変更は反映されないので安定値を渡す */
  initialMarkdown: string
  onChange: (markdown: string) => void
  onBlur?: () => void
  /** 挿入した画像・ファイルの持ち主({@link MarkdownInput} 参照) */
  uploadOwner?: AttachmentOwner
  /** 画像の挿入を許可する({@link MarkdownInput} 参照) */
  allowImages?: boolean
  /** `@` 入力時のメンション候補({@link MarkdownInput} 参照) */
  mentionCandidates?: MentionCandidate[]
  /** 編集面の最小行数 */
  minRows?: number
  /** MDXEditor 本体に付けるクラス(ポップアップ用コンテナにもコピーされる) */
  className?: string
}>(function MdxEditorHost({
  initialMarkdown,
  onChange,
  onBlur,
  uploadOwner,
  allowImages,
  mentionCandidates,
  minRows = DEFAULT_MIN_ROWS,
  className,
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [isReady, setReady] = useState(false)

  const anchorRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      // モーダル外(コメント欄など)では null になり、MDXEditor 既定の document.body が使われる
      setContainer(el.closest<HTMLElement>('[data-slot="modal-dialog"]'))
      setReady(true)
    }
  }, [])

  return (
    // 最小行数は globals.css の --mdx-min-rows 経由で編集面(rich-text / source)に効かせる
    <div ref={anchorRef} style={{ '--mdx-min-rows': minRows } as CSSProperties}>
      {isReady && (
        <MdxEditorCore
          markdown={initialMarkdown}
          onChange={onChange}
          onBlur={onBlur}
          overlayContainer={container}
          uploadOwner={uploadOwner}
          allowImages={allowImages}
          mentionCandidates={mentionCandidates}
          className={className}
        />
      )}
    </div>
  )
})

/**
 * Markdown エディタ(非制御)。`defaultValue` は初回マウント時の値としてのみ使われる。
 * 外から内容をリセットしたい場合は `key` を変えて再マウントする。
 */
export const MarkdownInput: FC<{
  defaultValue: string
  onChange: (markdown: string) => void
  /** 文字数カウンタに使う現在値 */
  length: number
  label?: string
  maxLength?: number
  errorMessage?: string
  /**
   * 挿入した画像・ファイルの持ち主(ボード / Wiki スペース)。配信時にその可視判定が掛かる。
   * 省略すると全ログインユーザーが参照できる添付になるため、ボード・スペースに属する本文では必ず渡すこと
   */
  uploadOwner?: AttachmentOwner
  /**
   * true で画像を挿入できるようにする(既定 false。ツールバーの画像ボタン / 貼り付け / ドロップ)。
   * true にする本文は、保存先を添付の掃除の参照元(`src/lib/storage/attachment-ref.ts`)に加え、
   * `tests/components/markdown/image-editors.test.ts` の一覧に登録すること。加えないと貼った画像が掃除で消える
   */
  allowImages?: boolean
  /**
   * `@` 入力時に出すメンション候補。省略すると候補は出ない。
   * ボードに属する本文では、そのボードのメンバー(`getAssigneeOptions` の結果)を渡すこと
   */
  mentionCandidates?: MentionCandidate[]
  /** 編集面の最小行数(既定 {@link DEFAULT_MIN_ROWS}) */
  minRows?: number
}> = ({
  defaultValue,
  onChange,
  length,
  label,
  maxLength,
  errorMessage,
  uploadOwner,
  allowImages,
  mentionCandidates,
  minRows,
}) => {
  const { t } = useLocale()
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(defaultValue)
  const stableOwner = useStableOwner(uploadOwner)

  return (
    <EditorField label={label ?? t('content')} length={length} maxLength={maxLength} errorMessage={errorMessage}>
      <MdxEditorHost
        initialMarkdown={initialMarkdown}
        onChange={onChange}
        uploadOwner={stableOwner}
        allowImages={allowImages}
        mentionCandidates={mentionCandidates}
        minRows={minRows}
      />
    </EditorField>
  )
}

/**
 * 表示 ⇄ 編集をラベル行ごと共有して切り替える枠なしの本文フィールド。
 *
 * ラベル行と本文の位置を 1 か所で決めるため、モードを切り替えても見た目の差分は
 * MDXEditor のツールバーが差し込まれる分だけになる。枠線・角丸・編集面の padding は
 * globals.css の `mdxeditor-flat` で落としている。
 */
export const MarkdownField: FC<{
  /** 表示モードで描画する本文 */
  body: string
  isEditing: boolean
  /** 編集開始時の初期 Markdown。編集モードの間だけ MDXEditor をマウントする */
  defaultValue: string
  onChange: (markdown: string) => void
  /** 文字数カウンタに使う現在値 */
  length: number
  label?: string
  /** ラベルを読み上げ名だけにする({@link EditorField} 参照) */
  isLabelHidden?: boolean
  /** ラベル行の左側に置く補足({@link EditorField} 参照) */
  info?: ReactNode
  maxLength?: number
  /** 挿入した画像・ファイルの持ち主({@link MarkdownInput} 参照) */
  uploadOwner?: AttachmentOwner
  /** 画像の挿入を許可する({@link MarkdownInput} 参照) */
  allowImages?: boolean
  /** `@` 入力時のメンション候補({@link MarkdownInput} 参照) */
  mentionCandidates?: MentionCandidate[]
  /** 編集面の最小行数(既定 {@link DEFAULT_MIN_ROWS}) */
  minRows?: number
  /** ラベル行の右端に置く操作(表示モードの編集開始など) */
  action?: ReactNode
  /** 本文の下に右寄せで置く操作(編集モードのキャンセル / 保存など) */
  footer?: ReactNode
}> = ({
  body,
  isEditing,
  defaultValue,
  onChange,
  length,
  label,
  isLabelHidden,
  info,
  maxLength,
  uploadOwner,
  allowImages,
  mentionCandidates,
  minRows,
  action,
  footer,
}) => {
  const { t } = useLocale()
  const stableOwner = useStableOwner(uploadOwner)

  return (
    <EditorField
      label={label ?? t('content')}
      isLabelHidden={isLabelHidden}
      info={info}
      length={length}
      // カウンタは編集中だけ出す。ラベル行の高さは Label と action で決まるので出し入れしても動かない
      maxLength={isEditing ? maxLength : undefined}
      action={
        // 操作が片方のモードにしか無くてもラベル行の高さを動かさないよう、ボタン 1 個分の枠を残す
        action || footer ? <div className='flex min-h-8 items-center gap-2'>{action}</div> : undefined
      }
      isFlat
    >
      <div
        /**
         * 本文が短いときにモードの切り替えで高さが動かないよう、両モードで同じ最小高を確保する。
         * ツールバー + minRows 行がこの高さに収まる範囲で minRows を選ぶこと
         */
        className='min-h-24 px-3'
      >
        {isEditing ? (
          <MdxEditorHost
            initialMarkdown={defaultValue}
            onChange={onChange}
            uploadOwner={stableOwner}
            allowImages={allowImages}
            mentionCandidates={mentionCandidates}
            minRows={minRows}
            className={FLAT_CLASS}
          />
        ) : (
          <MarkdownView body={body} mentionUsers={mentionCandidates} />
        )}
      </div>
      {footer && <div className='mt-2 flex justify-end gap-2'>{footer}</div>}
    </EditorField>
  )
}

/**
 * Markdown エディタ(react-hook-form 対応)。
 * `constraintSchema` を渡すと必須マークと文字数上限をスキーマから反映する。
 */
export const MarkdownCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  label,
  errorMessage,
  uploadOwner,
  allowImages,
  mentionCandidates,
  minRows,
}: {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  label?: string
  errorMessage?: string
  /** 挿入した画像・ファイルの持ち主({@link MarkdownInput} 参照) */
  uploadOwner?: AttachmentOwner
  /** 画像の挿入を許可する({@link MarkdownInput} 参照) */
  allowImages?: boolean
  /** `@` 入力時のメンション候補({@link MarkdownInput} 参照) */
  mentionCandidates?: MentionCandidate[]
  /** 編集面の最小行数(既定 {@link DEFAULT_MIN_ROWS}) */
  minRows?: number
}) => {
  const { t } = useLocale()
  const { field } = useController({ control, name })
  const { isRequired, maxLength } = constraintSchema ? getFieldConstraints(constraintSchema, name) : {}

  const current = typeof field.value === 'string' ? field.value : ''
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(current)
  const stableOwner = useStableOwner(uploadOwner)

  return (
    <EditorField
      label={label ?? t('content')}
      isRequired={isRequired}
      length={current.length}
      maxLength={maxLength}
      errorMessage={errorMessage}
    >
      <MdxEditorHost // useController の onChange / onBlur は useCallback 済みで安定参照のためそのまま渡せる
        initialMarkdown={initialMarkdown}
        onChange={field.onChange}
        onBlur={field.onBlur}
        uploadOwner={stableOwner}
        allowImages={allowImages}
        mentionCandidates={mentionCandidates}
        minRows={minRows}
      />
    </EditorField>
  )
}
