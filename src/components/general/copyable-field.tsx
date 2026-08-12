'use client'

import { Button, Chip, cn, InputGroup, InputGroupProps, Label, TextField } from '@heroui/react'
import { FC, SVGProps, useState } from 'react'
import { useIsSmart } from './smart'

const EyeIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 16 16'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path d='M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z' />
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M1.38 8.28a.87.87 0 0 1 0-.566 7.003 7.003 0 0 1 13.238.006.87.87 0 0 1 0 .566A7.003 7.003 0 0 1 1.379 8.28ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
    />
  </svg>
)

const EyeSlashIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 16 16'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M3.28 2.22a.75.75 0 0 0-1.06 1.06l10.5 10.5a.75.75 0 1 0 1.06-1.06l-1.322-1.323a7.012 7.012 0 0 0 2.16-3.11.87.87 0 0 0 0-.567A7.003 7.003 0 0 0 4.82 3.76l-1.54-1.54Zm3.196 3.195 1.135 1.136A1.502 1.502 0 0 1 9.45 8.389l1.136 1.135a3 3 0 0 0-4.109-4.109Z'
    />
    <path d='m7.812 10.994 1.816 1.816A7.003 7.003 0 0 1 1.38 8.28a.87.87 0 0 1 0-.566 6.985 6.985 0 0 1 1.113-2.039l2.513 2.513a3 3 0 0 0 2.806 2.806Z' />
  </svg>
)

const ClipboardDocumentIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 16 16'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M11.986 3H12a2 2 0 0 1 2 2v6a2 2 0 0 1-1.5 1.937v-2.523a2.5 2.5 0 0 0-.732-1.768L8.354 5.232A2.5 2.5 0 0 0 6.586 4.5H4.063A2 2 0 0 1 6 3h.014A2.25 2.25 0 0 1 8.25 1h1.5a2.25 2.25 0 0 1 2.236 2ZM10.5 4v-.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4h3Z'
    />
    <path d='M3 6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-3.586a1 1 0 0 0-.293-.707L7.293 6.293A1 1 0 0 0 6.586 6H3Z' />
  </svg>
)

const ClipboardDocumentCheckIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 16 16'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M11.986 3H12a2 2 0 0 1 2 2v6a2 2 0 0 1-1.5 1.937V7A2.5 2.5 0 0 0 10 4.5H4.063A2 2 0 0 1 6 3h.014A2.25 2.25 0 0 1 8.25 1h1.5a2.25 2.25 0 0 1 2.236 2ZM10.5 4v-.75a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V4h3Z'
    />
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M2 7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm6.585 1.08a.75.75 0 0 1 .336 1.005l-1.75 3.5a.75.75 0 0 1-1.16.234l-1.75-1.5a.75.75 0 0 1 .977-1.139l1.02.875 1.321-2.64a.75.75 0 0 1 1.006-.336Z'
    />
  </svg>
)

export const CopyableField: FC<{
  text: string
  label?: string
  isMask?: boolean
  variant?: InputGroupProps['variant']
  isSmart?: boolean
  className?: string
  onCopied?: () => void
}> = ({ text, label, isMask, variant, isSmart: isSmartProp, className, onCopied }) => {
  const isSmart = useIsSmart(isSmartProp)
  const [isVisible, setIsVisible] = useState(false)
  const toggleVisibility = () => setIsVisible(!isVisible)
  const [isCopied, setIsCopied] = useState(false)

  return (
    <TextField type={!isMask || isVisible ? 'text' : 'password'} isReadOnly className={cn('relative', className)}>
      {label && <Label className={isSmart ? 'text-xs font-light' : ''}>{label}</Label>}
      <InputGroup // isSmart: 既定 36px を 28px に詰める
        variant={variant}
        className={isSmart ? 'min-h-7' : ''}
      >
        <InputGroup.Input
          value={text}
          disabled
          // min-w-0: 幅を絞って使ったときに input の既定幅(約20文字)が優先され、コピーボタンが枠外へ押し出されるのを防ぐ
          className={cn('min-w-0 font-mono', isSmart ? 'py-1' : '')}
        />
        <InputGroup.Suffix className='pr-0'>
          {isMask && (
            <Button
              isIconOnly
              size='sm'
              variant='ghost'
              // isSmart: size='sm' の 32px は 28px の枠に収まらない
              className={isSmart ? 'size-6' : ''}
              onPress={toggleVisibility}
            >
              {isVisible ? <EyeSlashIcon /> : <EyeIcon />}
            </Button>
          )}
          <Button
            isIconOnly
            size='sm'
            variant='ghost'
            className={isSmart ? 'size-6' : ''}
            onPress={async () => {
              try {
                // 安全なコンテキスト(https / localhost)の外では navigator.clipboard 自体が無く、参照だけで例外になる
                await navigator.clipboard.writeText(text)
              } catch {
                // コピーできていないので、成功の表示はしない
                return
              }
              setIsCopied(true)
              setTimeout(() => setIsCopied(false), 2000)
              if (onCopied) {
                onCopied()
              }
            }}
            isDisabled={isCopied}
          >
            {isCopied ? <ClipboardDocumentCheckIcon className='text-green-400' /> : <ClipboardDocumentIcon />}
          </Button>
        </InputGroup.Suffix>
      </InputGroup>
      {isCopied && (
        <Chip className='absolute right-0 py-0' color='success' variant='soft'>
          Copied!
        </Chip>
      )}
    </TextField>
  )
}
