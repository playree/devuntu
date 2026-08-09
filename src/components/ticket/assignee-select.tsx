'use client'

import { UserAvatar } from '@/components/general/avatar'
import { MultiButton } from '@/components/general/button'
import { XCircleIcon } from '@/components/general/select'
import { useIsSmart } from '@/components/general/smart'
import { useSelfUserId } from '@/lib/use-user'
import { useLocale } from '@/locale/client'
import { ComboBox, EmptyState, ErrorMessage, Input, Label, ListBox, cn } from '@heroui/react'
import { FC, Ref } from 'react'
import { Control, Controller, FieldPath, FieldValues } from 'react-hook-form'

/** 担当者の選択肢。`getAssigneeOptions` が返す形と構造的に一致させる */
export type AssigneeOption = {
  id: string
  name: string
  image?: string | null
  /** アバターを出さない選択肢(絞り込みの「すべて」「未割り当て」などユーザー以外) */
  hideAvatar?: boolean
}

/**
 * 「自分を選択」ショートカット。担当者 ComboBox のラベル行に置く。
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
       * Select / ComboBox は ButtonContext にトリガーの props(押下で popover を開く / aria-labelledby)を
       * 流すため、slot={null} で継承を切る。付けないと押下でトリガーと同じ動作になり popover が開くだけで
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

type AssigneeSelectFieldProps = {
  /**
   * `getAssigneeOptions` が返すボードメンバー。
   * 絞り込みでは all / none のセンチネルを `hideAvatar` 付きで混ぜてもよい。
   */
  options: AssigneeOption[]
  value: string | null
  onChange: (value: string | null) => void
  /** ラベルは `assignee` 固定だが、絞り込み等で変えたい場合のみ上書きする */
  label?: string
  /** ラベルを読み上げ用にだけ残す(見出しを呼び出し側で出す場合) */
  isLabelHidden?: boolean
  /**
   * 未選択時の表示。既定は「未割り当て」。
   * 絞り込みでは未選択が「すべて」を意味し、「未割り当て」は実在の選択肢なので上書きすること
   */
  placeholder?: string
  isClearable?: boolean
  isDisabled?: boolean
  errorMessage?: string
  variant?: 'primary' | 'secondary'
  isSmart?: boolean
  onBlur?: () => void
  ref?: Ref<HTMLDivElement>
}

/**
 * 担当者の単一選択。入力で候補を絞り込み、候補と入力欄の両方にアバターを出す。
 *
 * HeroUI の ComboBox で構成する。絞り込みは ComboBox 内蔵(react-aria が useFilter の contains を
 * 既定の defaultFilter にする)なので、タグ選択のように Autocomplete.Filter を自前で組む必要はない。
 *
 * 自分がその候補に居ない(ボードのメンバーでない)場合や無効時は「自分を選択」を出さない。
 *
 * `isClearable` を付けると未選択(null)へ戻せる。入力を空にした場合も react-aria が値を null にする。
 */
export const AssigneeSelectField = ({
  options,
  value,
  onChange,
  label,
  isLabelHidden,
  placeholder,
  isClearable = false,
  isDisabled = false,
  errorMessage,
  variant,
  isSmart: isSmartProp,
  onBlur,
  ref,
}: AssigneeSelectFieldProps) => {
  const { t } = useLocale()
  const isSmart = useIsSmart(isSmartProp)
  const selfUserId = useSelfUserId()
  const canSelectSelf = !isDisabled && !!selfUserId && options.some((option) => option.id === selfUserId)
  const selected = value ? options.find((option) => option.id === value) : undefined
  const hasAvatar = !!selected && !selected.hideAvatar
  const hasClear = isClearable && !!value && !isDisabled

  return (
    <ComboBox
      selectionMode='single'
      value={value}
      variant={variant}
      isDisabled={isDisabled}
      isInvalid={!!errorMessage}
      // 候補が 0 件(ロード前 / メンバーなし)でも開けるようにする(react-aria は collection が空だと開かない)
      allowsEmptyCollection
      fullWidth
      onChange={(key) => onChange(key === null ? null : key.toString())}
      onBlur={onBlur}
      ref={ref}
    >
      <div // ラベル行を横並びにする。react-aria は Context で Label を解決するので div で包んでも紐付けは保たれる
        className='flex items-center justify-between gap-2'
      >
        <Label className={cn(isSmart ? 'text-xs font-light' : '', isLabelHidden ? 'sr-only' : '')}>
          {label ?? t('assignee')}
        </Label>
        {canSelectSelf && <SelfAssigneeAction onPress={() => onChange(selfUserId)} />}
      </div>
      <ComboBox.InputGroup>
        {/**
         * アバターとクリアは Input より前に置くこと。ComboBox.InputGroup は最後の子を Trigger として扱い、
         * それ以外を Trigger の前に並べる。加えて combo-box.css が Input と Trigger の隣接
         * (input:has(+ .combo-box__trigger))で右余白を当てているため、間に挟むとその指定が外れる。
         * トリガー自身と同じく、入力欄には絶対配置で重ねる(input-group が relative)
         */}
        {hasAvatar && (
          <span className='pointer-events-none absolute inset-y-0 inset-s-2 z-10 flex items-center'>
            <UserAvatar name={selected.name} image={selected.image} size='xs' />
          </span>
        )}
        {hasClear && (
          <span
            /**
             * Trigger は button なので、その中に入れると入れ子になる。ここは Trigger の兄弟だが、
             * キーボードからは入力を消せば未選択に戻せるため span + role='button' に揃える
             */
            role='button'
            // 共通部品と同じくローカライズ不要とする
            aria-label='clear'
            tabIndex={-1}
            className='absolute inset-y-0 inset-e-6 z-10 inline-flex cursor-pointer items-center opacity-60 hover:opacity-100'
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
          >
            <XCircleIcon width={16} />
          </span>
        )}
        <Input // isSmart: 既定 36px を 28px に詰める
          className={cn(
            isSmart ? 'min-h-7 py-1' : undefined,
            // 重ねたアバター(inset-s-2 + 16px)とクリア(inset-e-6 + 16px)の分だけ内側を空ける
            hasAvatar ? 'ps-8' : undefined,
            hasClear ? 'pe-11' : undefined,
          )}
          placeholder={placeholder ?? t('unassigned')}
        />
        <ComboBox.Trigger /* 必ず最後の子にすること(InputGroup が最後の子を Trigger として扱う) */ />
      </ComboBox.InputGroup>
      <ErrorMessage className={isSmart ? '' : 'min-h-4'}>{errorMessage}</ErrorMessage>
      <ComboBox.Popover>
        <ListBox renderEmptyState={() => <EmptyState>{t('msg_no_matching_assignees')}</EmptyState>}>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.name} className='min-h-min py-1'>
              <span className='flex items-center gap-1.5'>
                {option.hideAvatar ? (
                  // アバターの無い選択肢でも名前の左端を揃える
                  <span className='size-4' />
                ) : (
                  <UserAvatar name={option.name} image={option.image} size='xs' />
                )}
                {option.name}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
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
