'use client'

import { useLocale } from '@/locale/client'
import { Button, ButtonProps, ErrorMessage, Label, TextField } from '@heroui/react'
import Image from 'next/image'
import { useEffect, useMemo, useRef } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

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
}: { variant: ButtonProps['variant'] } & {
  control: Control<TFieldValues>
  name: TName
  accept?: string
  label?: string
  isRequired?: boolean
  errorMessage?: string
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
          file={(value as unknown) instanceof File ? value : null}
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
  onChange,
  onBlur,
  inputRef,
  variant,
}: { variant: ButtonProps['variant'] } & {
  accept: string
  label?: string
  isRequired?: boolean
  errorMessage?: string
  file: File | null
  onChange: (file: File | undefined) => void
  onBlur: () => void
  inputRef: React.Ref<HTMLInputElement>
}) => {
  const { t } = useLocale()
  const localRef = useRef<HTMLInputElement>(null)

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  return (
    <TextField isInvalid={!!errorMessage}>
      <Label>
        {label}
        {isRequired ? '*' : ''}
      </Label>
      <div className='flex items-center gap-3'>
        <div className='flex h-12 w-12 items-center'>
          {preview && <Image src={preview} alt='preview' width={48} height={48} className='border object-cover' />}
        </div>
        <input
          type='file'
          accept={accept}
          ref={(el) => {
            localRef.current = el
            if (typeof inputRef === 'function') inputRef(el)
          }}
          onBlur={onBlur}
          onChange={(event) => {
            onChange(event.target.files?.[0])
          }}
          className='hidden'
        />
        <Button type='button' size='sm' variant={variant} onPress={() => localRef.current?.click()}>
          {t('select_file')}
        </Button>
        <span className='text-default-500 truncate text-sm'>{file?.name ?? t('no_file_selected')}</span>
      </div>
      <ErrorMessage className='min-h-4'>{errorMessage}</ErrorMessage>
    </TextField>
  )
}
