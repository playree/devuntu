'use client'

import { MultiButton } from '@/components/general/button'
import { SingleSelectField, SingleSelectFieldProps } from '@/components/general/select'
import { useSelfUserId } from '@/lib/use-user'
import { useLocale } from '@/locale/client'
import { FC } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

/**
 * 「自分を選択」ショートカット。担当者 Select のラベル行(labelAction)に置く。
 *
 * 担当者が userId ではない絞り込み(チケット一覧の 'any' | 'me' | 'none')でも使えるよう、
 * 何をセットするかは呼び出し側の onPress に任せる。
 */
export const SelfAssigneeAction: FC<{
  onPress: () => void
  isDisabled?: boolean
}> = ({ onPress, isDisabled }) => {
  const { t } = useLocale()
  return (
    <MultiButton
      /**
       * Select は ButtonContext にトリガーの props(押下で popover を開く / aria-labelledby)を流すため、
       * slot={null} で継承を切る。付けないと押下でトリガーと同じ動作になり popover が開くだけで
       * onPress が効かず、読み上げ名もトリガーと同じになる(InputSearchField の検索ボタンと同じ事情)
       */
      slot={null}
      variant='ghost'
      size='sm'
      // ラベル行に収めるためボタンの箱を潰してテキストリンク風にする(isSmart の高さ調整は不要)
      isSmart={false}
      className='text-primary h-auto min-w-0 px-1 py-0 text-xs font-light underline-offset-2 hover:underline'
      isDisabled={isDisabled}
      onPress={onPress}
    >
      {t('select_self')}
    </MultiButton>
  )
}

type AssigneeSelectFieldProps = Omit<SingleSelectFieldProps, 'label' | 'labelAction'> & {
  /** ラベルは `assignee` 固定だが、絞り込み等で変えたい場合のみ上書きする */
  label?: string
}

/**
 * 担当者の単一選択。`SingleSelectField` にラベル行の「自分を選択」を足しただけの薄いラッパ。
 *
 * `groupOptions` は `getAssigneeOptions` が返す userId -> 表示名(絞り込みでは all / none の
 * センチネルを混ぜてもよい)。自分がその候補に居ない(ボードのメンバーでない)場合や
 * 無効時はショートカットを出さない。
 */
export const AssigneeSelectField = ({ label, groupOptions, onChange, ...props }: AssigneeSelectFieldProps) => {
  const { t } = useLocale()
  const selfUserId = useSelfUserId()
  const canSelectSelf = !props.isDisabled && !!selfUserId && !!groupOptions[selfUserId]

  return (
    <SingleSelectField
      {...props}
      label={label ?? t('assignee')}
      groupOptions={groupOptions}
      onChange={onChange}
      labelAction={canSelectSelf ? <SelfAssigneeAction onPress={() => onChange(selfUserId)} /> : null}
    />
  )
}

/**
 * react-hook-form 対応の担当者選択。描画は AssigneeSelectField に委譲する。
 * `SingleSelectCtrl`(general/select.tsx) と同じ形。
 */
export const AssigneeSelectCtrl = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control,
  name,
  ...props
}: Omit<AssigneeSelectFieldProps, 'value' | 'onChange' | 'onBlur' | 'ref'> & {
  control: Control<TFieldValues>
  name: TName
}) => {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, value, onBlur, ref } }) => (
        <AssigneeSelectField {...props} value={value ?? null} onChange={onChange} onBlur={onBlur} ref={ref} />
      )}
    />
  )
}
