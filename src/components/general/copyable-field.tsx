'use client'

import { Button, Chip, cn, InputGroup, InputGroupProps, TextField } from '@heroui/react'
import { FC, useState } from 'react'
import { FieldLabel } from './field'
import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon, EyeIcon, EyeSlashIcon } from './icons'
import { useIsSmart } from './smart'
import { useGeneralUiText } from './ui-text'
import { useCopyToClipboard } from './use-copy-to-clipboard'

export const CopyableField: FC<
  {
    text: string
    /** クリップボードへ渡す値。未指定なら表示している text をそのままコピーする */
    copyText?: string
    isMask?: boolean
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
  isMask,
  variant,
  isSmart: isSmartProp,
  className,
  copyLabel,
  onCopied,
}) => {
  const isSmart = useIsSmart(isSmartProp)
  const uiText = useGeneralUiText()
  const [isVisible, setIsVisible] = useState(false)
  const toggleVisibility = () => setIsVisible(!isVisible)
  const { isCopied, copy } = useCopyToClipboard()

  return (
    <TextField
      type={!isMask || isVisible ? 'text' : 'password'}
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
                // アイコンは aria-hidden なので、読み上げ名はボタン側で与える
                aria-label={isVisible ? uiText.hide : uiText.show}
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
