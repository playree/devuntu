'use client'

import { type LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip, ChipProps } from '@heroui/react'
import { FC } from 'react'

/** 列挙値ごとのロケールキーと Chip の表示色 */
export type EnumChipMap<K extends string> = Record<K, { item: LocaleItem; color: ChipProps['color'] }>

/**
 * 列挙値を表示する Chip と、同じ文言の選択肢(Record<値, 表示名>)を map から作る。
 * 選択肢はキーの並び順になるので、map は表示したい順に書くこと。
 */
export const createEnumChip = <K extends string>(map: EnumChipMap<K>) => {
  const EnumChip: FC<{ value: K; size?: ChipProps['size'] }> = ({ value, size = 'sm' }) => {
    const { t } = useLocale()
    const { item, color } = map[value]
    return (
      <Chip // 幅の狭いセルに置かれてもラベルが途中で改行されないようにする
        variant='soft'
        color={color}
        size={size}
        className='whitespace-nowrap'
      >
        <Chip.Label>{t(item)}</Chip.Label>
      </Chip>
    )
  }

  const useOptions = (): Record<K, string> => {
    const { t } = useLocale()
    return Object.fromEntries((Object.keys(map) as K[]).map((key) => [key, t(map[key].item)])) as Record<K, string>
  }

  return { EnumChip, useOptions }
}
