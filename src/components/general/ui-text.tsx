'use client'

import { createContext, FC, ReactNode, useContext, useMemo } from 'react'

/**
 * general 配下の部品が内部で表示する文言。
 * このフォルダはロケールへ依存させない方針なので、アプリ側から GeneralUiTextProvider で注入する。
 */
export type GeneralUiText = {
  ok: string
  cancel: string
  confirmed: string
  copy: string
  copied: string
  show: string
  hide: string
  clear: string
  search: string
  notSelected: string
  on: string
  off: string
  themeSelect: string
  themeSystem: string
  themeLight: string
  themeDark: string
  prev: string
  next: string
  rowsPerPage: string
  perPage: (rows: number) => string
  noResults: string
  tableEmpty: string
  resultRange: (start: number, end: number, total: number) => string
  waitSeconds: (sec: number) => string
}

/** Provider の外で使われたときの既定値 */
const DEFAULT_UI_TEXT: GeneralUiText = {
  ok: 'OK',
  cancel: 'Cancel',
  confirmed: 'Confirmed',
  copy: 'Copy',
  copied: 'Copied!',
  show: 'Show',
  hide: 'Hide',
  clear: 'Clear',
  search: 'Search',
  notSelected: 'Not selected',
  on: 'ON',
  off: 'OFF',
  themeSelect: 'Select theme',
  themeSystem: 'auto',
  themeLight: 'light',
  themeDark: 'dark',
  prev: 'Prev',
  next: 'Next',
  rowsPerPage: 'Rows per page',
  perPage: (rows) => `${rows} / page`,
  noResults: '0 results',
  tableEmpty: 'No data',
  resultRange: (start, end, total) => `${start} to ${end} of ${total} results`,
  waitSeconds: (sec) => `wait ${sec}s`,
}

const GeneralUiTextContext = createContext<GeneralUiText>(DEFAULT_UI_TEXT)

export const useGeneralUiText = () => useContext(GeneralUiTextContext)

export const GeneralUiTextProvider: FC<{ uiText: Partial<GeneralUiText>; children: ReactNode }> = ({
  uiText,
  children,
}) => {
  const value = useMemo(() => ({ ...DEFAULT_UI_TEXT, ...uiText }), [uiText])
  return <GeneralUiTextContext.Provider value={value}>{children}</GeneralUiTextContext.Provider>
}
