'use client'

import { SingleSelectField } from '@/components/general/select'
import { TicketSelectField, TicketSelectOption, useTicketCandidates } from '@/components/ticket/ticket-select'
import { parseTicketDisplayId, ticketDisplayId } from '@/lib/board/ticket-id'
import {
  TICKET_RELATION_FILTER_LOCALE,
  TICKET_RELATION_FILTERS,
  TicketRelationFilter,
} from '@/lib/board/ticket-relation-rule'
import { zRelatedTo } from '@/lib/schema/schema-ticket'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'

export type RelatedTicketFilterValue = { relatedTo: string; relation: TicketRelationFilter }

/**
 * 絞り込みの「関係するチケット」(表示ID)と「関係」(子 / 関連 / 両方)。
 * GridBox の中に 2 セルとして並べるので、各セルの列幅は呼び出し側から渡す。
 * 表示IDは正規の形(キー大文字・番号の先頭ゼロなし)に揃えて onChange へ渡す。
 */
export const RelatedTicketFilter: FC<{
  value: RelatedTicketFilterValue
  onChange: (value: RelatedTicketFilterValue) => void
  /** 候補の検索。対象ボードの切り替えに追従させるなら useCallback で依存に含める */
  fetchCandidates: (keyword: string) => Promise<TicketSelectOption[]>
  className: { ticket: string; relation: string }
}> = ({ value, onChange, fetchCandidates, className }) => {
  const { t } = useLocale()
  const [input, setInput] = useState(value.relatedTo)
  const [isInvalid, setInvalid] = useState(false)
  const { candidates, isSearching, activate } = useTicketCandidates(fetchCandidates, input)

  const relationOptions = Object.fromEntries(
    TICKET_RELATION_FILTERS.map((relation) => [relation, t(TICKET_RELATION_FILTER_LOCALE[relation])]),
  )

  const applyRelatedTo = (relatedTo: string) => {
    setInvalid(false)
    onChange({ ...value, relatedTo })
  }

  /** 表示IDとして読めない値は絞り込みに使わず、入力欄にエラーを出す */
  const submit = () => {
    const parsed = zRelatedTo.safeParse(input)
    if (!parsed.success) {
      setInvalid(true)
      return
    }
    // かんばんは表示IDの文字列一致で絞るので、`abc-01` のような入力も `ABC-1` に揃える
    const displayId = parseTicketDisplayId(parsed.data)
    applyRelatedTo(displayId ? ticketDisplayId(displayId) : '')
  }

  return (
    <>
      <div className={className.ticket}>
        <TicketSelectField
          label={t('related_to_ticket')}
          aria-label={t('related_to_ticket')}
          placeholder={t('search_ticket')}
          options={candidates}
          isLoading={isSearching}
          inputValue={input}
          onInputChange={(next) => {
            setInput(next)
            setInvalid(false)
            // 入力を消したら絞り込みも解除する
            if (!next.trim() && value.relatedTo) {
              onChange({ ...value, relatedTo: '' })
            }
          }}
          onSelect={(option) => {
            setInput(option.displayId)
            applyRelatedTo(option.displayId)
          }}
          onSubmit={submit}
          onClear={() => {
            setInput('')
            applyRelatedTo('')
          }}
          onFocus={activate}
          errorMessage={isInvalid ? t('@invalid_display_id') : undefined}
        />
      </div>

      <div className={className.relation}>
        <SingleSelectField
          label={t('relation_filter')}
          groupOptions={relationOptions}
          value={value.relation}
          onChange={(next) => {
            const relation = TICKET_RELATION_FILTERS.find((item) => item === next) ?? value.relation
            onChange({ ...value, relation })
          }}
        />
      </div>
    </>
  )
}
