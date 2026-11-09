'use client'

import { FC, ReactNode } from 'react'

/** 履歴の差分で、本文以外の項目の変化(前 → 後)を1行で出す */
export const RevisionFieldChange: FC<{ label: string; before: ReactNode; after: ReactNode }> = ({
  label,
  before,
  after,
}) => (
  <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
    <span className='text-muted w-full text-xs sm:w-24'>{label}</span>
    <span className='text-muted break-all line-through'>{before}</span>
    <span className='text-muted'>→</span>
    <span className='break-all'>{after}</span>
  </div>
)

/** 比較元の無い版(最初の版など)の本文をそのまま出す。空の本文は枠ごと出さない */
export const RevisionContentView: FC<{ content: string }> = ({ content }) =>
  content && (
    <pre className='border-border rounded-lg border px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap'>
      {content}
    </pre>
  )
