'use client'

import { useLocale } from '@/locale/client'
import { Button, cn, ErrorMessage, InputGroup, InputProps, Label, ProgressBar, TextField } from '@heroui/react'
import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import { ChangeEvent, FC, SVGProps, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { useIsSmart } from './general/smart'

const EyeIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 20 20'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path d='M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' />
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
    />
  </svg>
)

const EyeSlashIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 20 20'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z'
    />
    <path d='m10.748 13.93 2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z' />
  </svg>
)

const COLOR: ('default' | 'danger' | 'warning' | 'success' | 'accent')[] = [
  'default',
  'danger',
  'warning',
  'success',
  'accent',
]

export const PasswordScore: FC<{
  label: string
  score: number
  isDisabled?: boolean
}> = ({ label, score, isDisabled }) => {
  return (
    <ProgressBar
      size='md'
      maxValue={4}
      value={score}
      className='my-1 px-1'
      color={COLOR[score]}
      valueLabel=' '
      // isDisabled={isDisabled}
    >
      <Label className={isDisabled ? 'text-xs text-gray-600 dark:text-gray-400' : 'text-xs'}>{label}</Label>
      <ProgressBar.Output />
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  )
}

export const InputCtrlPassword = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  type = 'text',
  onChanged,
  label,
  isRequired,
  isReadOnly,
  errorMessage,
  requiredPasswordScore,
  variant,
  isSmart: isSmartProp,
  ...props
}: InputProps & {
  control?: Control<TFieldValues>
  name: TName
  onChanged?: (e: ChangeEvent<HTMLInputElement>) => void
  label?: string
  isRequired?: boolean
  isReadOnly?: boolean
  errorMessage?: string
  requiredPasswordScore?: number
  isSmart?: boolean
}) => {
  const { t } = useLocale()
  const isSmart = useIsSmart(isSmartProp)
  const [isVisible, setIsVisible] = useState(false)
  const toggleVisibility = () => setIsVisible(!isVisible)
  const [passwordScore, setPasswordScore] = useState(0)

  return (
    <>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, value } }) => (
          <TextField
            type={isVisible ? 'text' : 'password'}
            className='relative'
            isInvalid={!!errorMessage}
            isReadOnly={isReadOnly}
          >
            <Label className={isSmart ? 'text-xs font-light' : ''}>
              {label}
              {isRequired ? '*' : ''}
            </Label>
            <InputGroup // isSmart: 既定 36px を 28px に詰める
              variant={variant}
              className={isSmart ? 'min-h-7' : ''}
            >
              <InputGroup.Input
                {...props}
                className={cn(isSmart ? 'py-1' : '', props.className)}
                onChange={(event) => {
                  if (requiredPasswordScore) {
                    const zxcvbn = new ZxcvbnFactory()
                    const res = zxcvbn.check(event.target.value)
                    setPasswordScore(res.score)
                  }

                  if (onChanged) {
                    onChanged(event)
                  }
                  onChange(event)
                }}
                value={value || (type === 'number' ? '0' : '')}
              />
              <InputGroup.Suffix className='pr-0'>
                <Button
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  // isSmart: size='sm' の 32px は 28px の枠に収まらない
                  className={isSmart ? 'size-6' : ''}
                  // アイコンは aria-hidden なので、読み上げ名はボタン側で与える
                  aria-label={isVisible ? t('hide') : t('show')}
                  onPress={toggleVisibility}
                >
                  {isVisible ? <EyeSlashIcon /> : <EyeIcon />}
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
          </TextField>
        )}
      />
      {requiredPasswordScore && (
        <PasswordScore
          label={`${t('password_score')} = ${passwordScore} ( ${t('password_score_required', { score: requiredPasswordScore })} )`}
          score={passwordScore}
        />
      )}
    </>
  )
}
