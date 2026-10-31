'use client'

import { Button, Chip, cn, InputGroup, InputGroupProps, TextField } from '@heroui/react'
import { FC } from 'react'
import { FieldLabel } from './field'
import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon } from './icons'
import { useIsSmart } from './smart'
import { useGeneralUiText } from './ui-text'
import { useCopyToClipboard } from './use-copy-to-clipboard'

export const CopyableField: FC<
  {
    text: string
    /** クリップボードへ渡す値。未指定なら表示している text をそのままコピーする */
    copyText?: string
    /** 改行を含む値(行を継いだコマンドなど)を、行ごとに見せる */
    isMultiline?: boolean
    variant?: InputGroupProps['variant']
    isSmart?: boolean
    className?: string
    /** コピーボタンの読み上げ名。未指定なら GeneralUiText の copy */
    copyLabel?: string
    onCopied?: () => void
  } & (
    | { label: string; 'aria-label'?: never }
    /** ラベルを出さずに使うときは読み上げ名を必須にする(無いと react-aria が警告を出す) */
    | { label?: never; 'aria-label': string }
  )
> = ({
  text,
  copyText,
  label,
  'aria-label': ariaLabel,
  isMultiline,
  variant,
  isSmart: isSmartProp,
  className,
  copyLabel,
  onCopied,
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const uiText = useGeneralUiText()
  const { isCopied, copy } = useCopyToClipboard()

  return (
    <TextField
      isReadOnly
      /**
       * react-aria は `<Label>` の有無をこのルートの props で判定するため、
       * 読み上げ名は input ではなくここへ渡す(input へは inputProps 経由で配られる)
       */
      aria-label={label ? undefined : ariaLabel}
      className={className}
    >
      {label && <FieldLabel isCompact={isSmart}>{label}</FieldLabel>}
      <div className='relative'>
        <InputGroup // isSmart: 既定 36px を 28px に詰める
          variant={variant}
          fullWidth
          className={isSmart ? 'min-h-7' : ''}
        >
          {isMultiline ? (
            <InputGroup.TextArea
              value={text}
              disabled
              rows={text.split('\n').length}
              /**
               * 幅が足りない行は折り返して全体を見せる(disabled の欄は横スクロールできない環境がある)。
               * 折り返した分は field-sizing で高さを伸ばし、rows は対応していないブラウザ向けの最小行数にする
               */
              className='field-sizing-content min-w-0 resize-none py-2 font-mono text-xs break-all'
            />
          ) : (
            <InputGroup.Input
              value={text}
              disabled
              // min-w-0: 幅を絞って使ったときに input の既定幅(約20文字)が優先され、コピーボタンが枠外へ押し出されるのを防ぐ
              className={cn('min-w-0 font-mono', isSmart ? 'py-1' : '')}
            />
          )}
          <InputGroup.Suffix className={cn('pr-0', isMultiline ? 'self-start pt-1' : '')}>
            <Button
              isIconOnly
              size='sm'
              variant='ghost'
              // isSmart: size='sm' の 32px は 28px の枠に収まらない
              className={isSmart ? 'size-6' : ''}
              aria-label={copyLabel ?? uiText.copy}
              onPress={async () => {
                /**
                 * このフォルダはロケールや通知(`@/components/notify`)へ依存させない方針なので、
                 * 失敗の通知は出さず、成功表示が出ないことで伝える。
                 */
                if ((await copy(copyText ?? text)) && onCopied) {
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
          <Chip className='absolute right-0 bottom-full mb-0.5 py-0' color='success' variant='soft'>
            {uiText.copied}
          </Chip>
        )}
      </div>
    </TextField>
  )
}
