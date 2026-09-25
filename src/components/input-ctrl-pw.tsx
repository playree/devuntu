'use client'

import { getPasswordScore, preloadPasswordScore } from '@/lib/password-score'
import { useLocale } from '@/locale/client'
import { Button, cn, ErrorMessage, InputGroup, InputProps, Label, ProgressBar, TextField } from '@heroui/react'
import { ChangeEvent, FC, useEffect, useRef, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { EyeIcon, EyeSlashIcon } from './general/icons'
import { useSmart } from './general/smart'

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
  isSmartForm: isSmartFormProp,
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
  isSmartForm?: boolean
}) => {
  const { t } = useLocale()
  const { isCompact, hasErrorArea } = useSmart(isSmartProp, isSmartFormProp)
  const [isVisible, setIsVisible] = useState(false)
  const toggleVisibility = () => setIsVisible(!isVisible)
  const [passwordScore, setPasswordScore] = useState(0)
  // 判定は非同期なので、連打で古い結果が後から反映されないように最新の入力だけを採用する
  const scoreSeqRef = useRef(0)

  useEffect(() => {
    if (requiredPasswordScore) {
      preloadPasswordScore()
    }
  }, [requiredPasswordScore])

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
            isRequired={isRequired}
            // validationBehavior の事情は general/input.tsx の InputField と同じ
            validationBehavior='aria'
          >
            <Label className={isCompact ? 'text-xs font-light' : ''} isRequired={isRequired}>
              {label}
            </Label>
            <InputGroup // isCompact: 既定 36px を 28px に詰める
              variant={variant}
              className={isCompact ? 'min-h-7' : ''}
            >
              <InputGroup.Input
                {...props}
                className={cn(isCompact ? 'py-1' : '', props.className)}
                onChange={(event) => {
                  if (requiredPasswordScore) {
                    const seq = ++scoreSeqRef.current
                    void getPasswordScore(event.target.value).then((score) => {
                      if (seq === scoreSeqRef.current) {
                        setPasswordScore(score)
                      }
                    })
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
                  // isCompact: size='sm' の 32px は 28px の枠に収まらない
                  className={isCompact ? 'size-6' : ''}
                  // アイコンは aria-hidden なので、読み上げ名はボタン側で与える
                  aria-label={isVisible ? t('hide') : t('show')}
                  onPress={toggleVisibility}
                >
                  {isVisible ? <EyeSlashIcon /> : <EyeIcon />}
                </Button>
              </InputGroup.Suffix>
            </InputGroup>
            <ErrorMessage className={hasErrorArea ? 'min-h-4' : ''}>{errorMessage}</ErrorMessage>
          </TextField>
        )}
      />
      {!!requiredPasswordScore && (
        <PasswordScore
          label={`${t('password_score')} = ${passwordScore} ( ${t('password_score_required', { score: requiredPasswordScore })} )`}
          score={passwordScore}
        />
      )}
    </>
  )
}
