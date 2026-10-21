'use client'

import { diffLines, foldDiffLines } from '@/lib/text-diff'
import { useLocale } from '@/locale/client'
import { cn } from '@heroui/react'
import { FC, useMemo } from 'react'
import { tv } from 'tailwind-variants'

const lineStyles = tv({
  base: 'px-2 break-all whitespace-pre-wrap',
  variants: {
    op: {
      same: '',
      add: 'bg-success/15',
      del: 'bg-danger/15 text-muted line-through',
      skip: 'text-muted text-center select-none',
    },
  },
})

const MARKS = { same: ' ', add: '+', del: '-' } as const

/** 行単位の差分。変更から離れた一致行は件数だけ出す */
export const TextDiffView: FC<{ before: string; after: string; className?: string }> = ({
  before,
  after,
  className,
}) => {
  const { t } = useLocale()
  const lines = useMemo(() => foldDiffLines(diffLines(before, after)), [before, after])

  return (
    <div className={cn('border-border overflow-x-auto rounded-lg border py-1 font-mono text-xs', className)}>
      {lines.map((line, index) =>
        line.op === 'skip' ? (
          <div key={index} className={lineStyles({ op: 'skip' })}>
            {t('msg_diff_unchanged_lines', { count: `${line.count}` })}
          </div>
        ) : (
          <div key={index} className={lineStyles({ op: line.op })}>
            <span className='mr-2 select-none'>{MARKS[line.op]}</span>
            {line.text || ' '}
          </div>
        ),
      )}
    </div>
  )
}
