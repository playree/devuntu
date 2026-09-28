'use client'

import { FieldError, FieldLabel, TriggerClearButton } from '@/components/general/field'
import { useSmart } from '@/components/general/smart'
import { StatusChip, TicketIdText } from '@/components/ticket/ticket-chip'
import type { TicketStatus } from '@/generated/prisma/enums'
import { useLocale } from '@/locale/client'
import { ComboBox, EmptyState, Input, ListBox, cn } from '@heroui/react'
import { FC, useEffect, useState } from 'react'

/** 候補のチケット。表示ID は呼び出し側(サーバー)で組み立てたものを渡す */
export type TicketSelectOption = { id: string; displayId: string; title: string; status: TicketStatus }

/** 候補検索を始めるまでの入力待ち */
const SEARCH_DEBOUNCE_MS = 300

/**
 * TicketSelectField の候補をサーバーから引く。入力が落ち着いてから検索し、後から届いた古い応答は捨てる。
 * 画面を開いただけで検索しないよう、`activate`(入力欄のフォーカス)まで読み込まない。
 * fetcher が変わると引き直すので、呼び出し側は useCallback で固定する
 */
export const useTicketCandidates = <T extends TicketSelectOption>(
  fetcher: (keyword: string) => Promise<T[]>,
  keyword: string,
) => {
  const [candidates, setCandidates] = useState<T[]>([])
  const [isSearching, setSearching] = useState(false)
  const [isActivated, setActivated] = useState(false)

  useEffect(() => {
    if (!isActivated) {
      return
    }
    let isCurrent = true
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const result = await fetcher(keyword)
        if (isCurrent) {
          setCandidates(result)
        }
      } catch {
        if (isCurrent) {
          setCandidates([])
        }
      } finally {
        if (isCurrent) {
          setSearching(false)
        }
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      isCurrent = false
      clearTimeout(timer)
    }
  }, [fetcher, keyword, isActivated])

  return { candidates, isSearching, activate: () => setActivated(true) }
}

/**
 * チケットを表示ID / 件名で探して選ぶ入力欄。候補の絞り込みは呼び出し側(サーバー検索)で済ませる前提で、
 * ComboBox 内蔵の絞り込みは使わない。候補を選ばずに入力した文字列(表示ID や番号)もそのまま値として残す
 */
export const TicketSelectField: FC<{
  options: TicketSelectOption[]
  inputValue: string
  onInputChange: (value: string) => void
  onSelect: (option: TicketSelectOption) => void
  /** 候補を選ばずに Enter を押したとき(入力した表示ID / 番号で確定する) */
  onSubmit?: () => void
  /** 入力欄にフォーカスしたとき。候補の読み込みを触るまで遅らせるのに使う */
  onFocus?: () => void
  /** 入力欄の中のクリアボタンを押したとき。未指定ならボタンを出さない */
  onClear?: () => void
  isLoading?: boolean
  /** 見出し。未指定なら aria-label だけで読み上げる */
  label?: string
  placeholder?: string
  errorMessage?: string
  isSmart?: boolean
  'aria-label': string
}> = ({
  options,
  inputValue,
  onInputChange,
  onSelect,
  onSubmit,
  onFocus,
  onClear,
  isLoading = false,
  label,
  placeholder,
  errorMessage,
  isSmart: isSmartProp,
  'aria-label': ariaLabel,
}) => {
  const { t } = useLocale()
  const { isCompact, hasErrorArea } = useSmart(isSmartProp)
  const hasClear = !!onClear && !!inputValue

  return (
    <ComboBox
      // 見出しを出すときは Label が名前になる
      aria-label={label ? undefined : ariaLabel}
      items={options}
      inputValue={inputValue}
      onInputChange={onInputChange}
      /**
       * 選択値は入力値から導く(入力が表示IDと一致する候補を選択中とみなす)。
       * null 固定だと選んでも選択値が変わらず閉じる処理が働かないうえ、呼び出し側が入力欄へ表示IDを入れた変化で
       * 候補の一覧が開き直る
       */
      value={options.find((option) => option.displayId === inputValue)?.id ?? null}
      onChange={(key) => {
        const option = options.find((item) => item.id === key)
        if (option) {
          onSelect(option)
        }
      }}
      defaultFilter={() => true}
      allowsCustomValue
      // 入力前でも最近のチケットを候補に出せるよう、フォーカスで開く
      menuTrigger='focus'
      allowsEmptyCollection
      isInvalid={!!errorMessage}
      fullWidth
      onFocus={onFocus}
    >
      {label && <FieldLabel isCompact={isCompact}>{label}</FieldLabel>}
      <ComboBox.InputGroup>
        {onClear && hasClear && (
          <TriggerClearButton // 配置の制約は UserSelectField と同じ(Input より前に置き、絶対配置で重ねる)。キーボードからは入力を消せば解除できる
            className='absolute inset-y-0 inset-e-6 z-10'
            onClear={onClear}
          />
        )}
        <Input
          className={cn(isCompact ? 'min-h-7 py-1' : undefined, hasClear ? 'pe-11' : undefined)}
          placeholder={placeholder}
          /**
           * 候補の一覧が開いていると、react-aria は Enter を一覧を閉じる操作として握り、フォームの送信まで届かない。
           * 候補にフォーカスが無い(aria-activedescendant が無い)Enter は、入力した値での確定として扱う。
           * 送信を二重にしないよう、ここで既定動作(フォームの submit)を止める
           */
          onKeyDownCapture={(e) => {
            if (!onSubmit || e.key !== 'Enter' || e.nativeEvent.isComposing) {
              return
            }
            if (e.currentTarget.getAttribute('aria-activedescendant')) {
              return
            }
            e.preventDefault()
            onSubmit()
          }}
        />
        <ComboBox.Trigger /* 必ず最後の子にすること(InputGroup が最後の子を Trigger として扱う) */ />
      </ComboBox.InputGroup>
      <FieldError hasErrorArea={hasErrorArea}>{errorMessage}</FieldError>
      <ComboBox.Popover>
        <ListBox
          renderEmptyState={() => <EmptyState>{isLoading ? t('searching') : t('msg_no_matching_tickets')}</EmptyState>}
        >
          {(option: TicketSelectOption) => (
            <ListBox.Item id={option.id} textValue={option.displayId} className='min-h-min py-1'>
              <span className='flex min-w-0 items-center gap-2'>
                <TicketIdText displayId={option.displayId} className='shrink-0' />
                <span className='min-w-0 truncate text-sm'>{option.title}</span>
                <StatusChip value={option.status} />
              </span>
            </ListBox.Item>
          )}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
