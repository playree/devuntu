import { FC, ReactNode } from 'react'

/** 読み取り専用の項目 1 行。ラベルを固定幅で左に置き、値を右に並べる */
export const MetaRow: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className='flex items-baseline gap-2'>
    <span className='text-muted w-24 shrink-0 text-xs'>{label}</span>
    <div className='min-w-0 text-sm'>{children}</div>
  </div>
)
