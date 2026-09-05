'use client'

import { SingleSelectCtrl } from '@/components/general/select'
import { TOKEN_EXPIRES } from '@/lib/token-expires'
import { useLocale } from '@/locale/client'
import { Control, FieldPath, FieldValues } from 'react-hook-form'

/**
 * 長期トークンの有効期限を選ぶ Select。
 *
 * エージェントのトークン発行とユーザーの MCP トークン発行で同じ選択肢を出すために共通化してある。
 */
export const TokenExpiresSelect = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
}: {
  control: Control<TFieldValues>
  name: TName
}) => {
  const { t } = useLocale()
  const groupOptions = Object.fromEntries(
    TOKEN_EXPIRES.map((value) => [
      value,
      value === 'none' ? t('no_expiration') : t('expires_in_days', { days: value }),
    ]),
  )
  return <SingleSelectCtrl control={control} name={name} label={t('token_expiration')} groupOptions={groupOptions} />
}
