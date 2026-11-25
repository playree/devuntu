'use client'

import { FC, ReactNode } from 'react'

export type RevisionChange = { id: string; label: string; before: ReactNode; after: ReactNode }

/** 履歴の差分で、本文以外の項目の変化(前 → 後)を出す */
export const RevisionChanges: FC<{ changes: readonly RevisionChange[]; className?: string }> = ({
  changes,
  className,
}) => {
  if (changes.length === 0) {
    return null
  }
  return (
    <div className={className}>
      {changes.map(({ id, label, before, after }) => (
        <div key={id} className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
          <span className='text-muted w-full text-xs sm:w-24'>{label}</span>
          <span className='text-muted break-all line-through'>{before}</span>
          <span className='text-muted'>→</span>
          <span className='break-all'>{after}</span>
        </div>
      ))}
    </div>
  )
}

/** 比較元の無い版(最初の版など)の本文をそのまま出す。空の本文は枠ごと出さない */
export const RevisionContentView: FC<{ content: string }> = ({ content }) =>
  content && (
    <pre className='border-border rounded-lg border px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap'>
      {content}
    </pre>
  )
