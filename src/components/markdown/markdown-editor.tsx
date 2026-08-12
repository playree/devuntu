'use client'

import { getFieldConstraints } from '@/lib/schema-util'
import { useLocale } from '@/locale/client'
import { cn, ErrorMessage, Label, Skeleton, TextField } from '@heroui/react'
import dynamic from 'next/dynamic'
import { CSSProperties, FC, memo, ReactNode, useCallback, useState } from 'react'
import { Control, FieldPath, FieldValues, useController } from 'react-hook-form'
import { z } from 'zod'
import { useIsSmart } from '../general/smart'
import { MarkdownView } from './markdown-view'
// 型のみの参照。実体(lexical / MDXEditor)は mdx-editor-core 側の動的 import に閉じたままになる
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

/** ローディング Skeleton も同じ変数で高さを合わせ、マウント時のガタつきを防ぐ */
const MIN_HEIGHT = 'calc(var(--mdx-min-rows, 6) * 1.5rem)'

// MDXEditor はブラウザ専用なので SSR から外す(lexical / codemirror も別チャンクへ分離される)
const MdxEditorCore = dynamic(() => import('./mdx-editor-core'), {
  ssr: false,
  loading: () => <Skeleton className='w-full rounded-xl' style={{ minHeight: MIN_HEIGHT }} />,
})

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
  /** 挿入した画像の添付先ボード({@link MarkdownInput} 参照) */
  uploadBoardId?: string | null
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
  uploadBoardId,
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
          uploadBoardId={uploadBoardId}
          mentionCandidates={mentionCandidates}
          className={className}
        />
      )}
    </div>
  )
})

/** ラベル・文字数・エラーの体裁(TagInput と同じ TextField ベース) */
const EditorField: FC<{
  label: string
  isRequired?: boolean
  length: number
  maxLength?: number
  errorMessage?: string
  /** ラベル行の右端に置く操作(文字数カウンタの後ろ) */
  action?: ReactNode
  /** 枠なし表示。エラー用の高さを常時確保しない */
  isFlat?: boolean
  children: ReactNode
}> = ({ label, isRequired, length, maxLength, errorMessage, action, isFlat, children }) => {
  const isSmart = useIsSmart()
  return (
    <TextField isInvalid={!!errorMessage} className='mb-0.5'>
      <div // action にはボタンが入るため、そのときだけ中央揃えにしてラベルと高さを合わせる
        className={cn('flex justify-between', action ? 'items-center' : 'items-baseline')}
      >
        <Label className={isSmart ? 'text-xs font-light' : ''}>
          {label}
          {isRequired ? '*' : ''}
        </Label>
        <div className='flex items-center gap-2'>
          {maxLength !== undefined && (
            <span className={`font-mono text-xs ${length > maxLength ? 'text-danger' : 'text-gray-500'}`}>
              {length} / {maxLength}
            </span>
          )}
          {action}
        </div>
      </div>
      {children}
      <ErrorMessage className={isFlat || isSmart ? undefined : 'min-h-4'}>{errorMessage}</ErrorMessage>
    </TextField>
  )
}

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
   * 挿入した画像の添付先ボード。配信時にこのボードの可視判定が掛かる。
   * 省略すると全ログインユーザーが参照できる添付になるため、ボードに属する本文では必ず渡すこと
   */
  uploadBoardId?: string | null
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
  uploadBoardId,
  mentionCandidates,
  minRows,
}) => {
  const { t } = useLocale()
  // 初回マウント時の値を固定する(MDXEditor は markdown prop の変更を取り込まない)
  const [initialMarkdown] = useState(defaultValue)

  return (
    <EditorField label={label ?? t('content')} length={length} maxLength={maxLength} errorMessage={errorMessage}>
      <MdxEditorHost
        initialMarkdown={initialMarkdown}
        onChange={onChange}
        uploadBoardId={uploadBoardId}
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
  maxLength?: number
  /** 挿入した画像の添付先ボード({@link MarkdownInput} 参照) */
  uploadBoardId?: string | null
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
  maxLength,
  uploadBoardId,
  mentionCandidates,
  minRows,
  action,
  footer,
}) => {
  const { t } = useLocale()

  return (
    <EditorField
      label={label ?? t('content')}
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
        className='min-h-24'
      >
        {isEditing ? (
          <MdxEditorHost
            initialMarkdown={defaultValue}
            onChange={onChange}
            uploadBoardId={uploadBoardId}
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
export const MarkdownEditor = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  constraintSchema,
  label,
  errorMessage,
  uploadBoardId,
  mentionCandidates,
  minRows,
}: {
  control: Control<TFieldValues>
  name: TName
  constraintSchema?: z.ZodObject
  label?: string
  errorMessage?: string
  /** 挿入した画像の添付先ボード({@link MarkdownInput} 参照) */
  uploadBoardId?: string | null
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
        uploadBoardId={uploadBoardId}
        mentionCandidates={mentionCandidates}
        minRows={minRows}
      />
    </EditorField>
  )
}
