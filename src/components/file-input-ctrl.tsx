'use client'

import { TrashIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { Button, ButtonProps, cn, ErrorMessage, Label, TextField } from '@heroui/react'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'
import { useIsSmart } from './general/smart'

export const FileInputCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  accept = 'image/*',
  label,
  isRequired,
  errorMessage,
  variant,
  existingUrl,
  isSmart,
}: { variant: ButtonProps['variant'] } & {
  control: Control<TFieldValues>
  name: TName
  accept?: string
  label?: string
  isRequired?: boolean
  errorMessage?: string
  existingUrl?: string | null
  isSmart?: boolean
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <FileField
          accept={accept}
          label={label}
          isRequired={isRequired}
          errorMessage={errorMessage}
          variant={variant}
          isSmart={isSmart}
          file={(value as unknown) instanceof File ? (value as File) : null}
          isCleared={value === null}
          existingUrl={existingUrl}
          onChange={onChange}
          onBlur={onBlur}
          inputRef={ref}
        />
      )}
    />
  )
}

const FileField = ({
  accept,
  label,
  isRequired,
  errorMessage,
  file,
  isCleared,
  existingUrl,
  onChange,
  onBlur,
  inputRef,
  variant,
  isSmart: isSmartProp,
}: { variant: ButtonProps['variant'] } & {
  accept: string
  label?: string
  isRequired?: boolean
  errorMessage?: string
  file: File | null
  isCleared?: boolean
  existingUrl?: string | null
  onChange: (file: File | null | undefined) => void
  onBlur: () => void
  inputRef: React.Ref<HTMLInputElement>
  isSmart?: boolean
}) => {
  const { t } = useLocale()
  const isSmart = useIsSmart(isSmartProp)
  const localRef = useRef<HTMLInputElement>(null)

  const [preview, setPreview] = useState<string | null>(null)

  // preview は file 選択/削除時に生成・更新し、変更・アンマウント時に revoke する
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview)
      }
    }
  }, [preview])

  // 表示画像: 新規選択ファイル優先、なければ(削除されていなければ)既存URL
  const displayUrl = preview ?? (isCleared ? null : (existingUrl ?? null))
  // 削除ボタン: 新規ファイル選択中、または既存表示中(未削除)に表示
  const showRemove = !!file || (!!existingUrl && !isCleared)

  const handleRemove = () => {
    // 新規ファイル選択中は既存に戻し、既存表示中はnull(サーバーで削除)
    onChange(file ? undefined : null)
    setPreview(null)
    if (localRef.current) {
      localRef.current.value = ''
    }
  }

  return (
    <TextField isInvalid={!!errorMessage}>
      <Label className={isSmart ? 'text-xs font-light' : ''} isRequired={isRequired}>
        {label}
      </Label>
      <div className={cn('flex items-center', isSmart ? 'gap-2' : 'gap-3')}>
        <div className={cn('flex items-center', isSmart ? 'size-8' : 'size-12')}>
          {displayUrl && (
            <Image
              src={displayUrl}
              alt='preview'
              width={isSmart ? 32 : 48}
              height={isSmart ? 32 : 48}
              unoptimized
              className='border object-cover'
            />
          )}
        </div>
        <input
          type='file'
          accept={accept}
          ref={(el) => {
            localRef.current = el
            if (typeof inputRef === 'function') {
              inputRef(el)
            }
          }}
          onBlur={onBlur}
          onChange={(event) => {
            const selected = event.target.files?.[0]
            onChange(selected)
            setPreview(selected ? URL.createObjectURL(selected) : null)
          }}
          className='hidden'
        />
        <Button
          type='button'
          size='sm'
          variant={variant}
          // isSmart: MultiButton の isSmart と同じ詰め方に揃える
          className={isSmart ? 'h-fit px-2 py-0.5' : ''}
          onPress={() => localRef.current?.click()}
        >
          {t('select_file')}
        </Button>
        {showRemove && (
          <Button
            type='button'
            size='sm'
            variant='danger-soft'
            isIconOnly
            className={isSmart ? 'size-6' : ''}
            // アイコンは aria-hidden なので、読み上げ名はボタン側で与える
            aria-label={t('delete')}
            onPress={handleRemove}
          >
            <TrashIcon width={16} />
          </Button>
        )}
        <span className={cn('text-default-500 truncate', isSmart ? 'text-xs' : 'text-sm')}>
          {file?.name ?? t('no_file_selected')}
        </span>
      </div>
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
    </TextField>
  )
}
