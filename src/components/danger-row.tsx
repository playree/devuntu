import { FC, ReactNode } from 'react'

/** デンジャーゾーンの危険操作 1 件分の行。見出し + 説明 + 右寄せのボタン */
export const DangerRow: FC<{ title: string; description: string; children: ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <div className='flex flex-wrap items-center gap-2 py-3'>
    <div className='min-w-0 flex-1'>
      <div className='text-sm font-semibold'>{title}</div>
      <div className='text-muted text-xs'>{description}</div>
    </div>
    {children}
  </div>
)
