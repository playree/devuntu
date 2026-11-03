'use client'

import { createContext, FC, ReactNode, useContext } from 'react'

/**
 * ファイル添付の上限(MB)。環境変数 `ATTACHMENT_MAX_SIZE_MB` はサーバーでしか読めないので、
 * レイアウトで解決して Provider 経由で渡す。Provider の外では環境変数の既定値と同じ 10 になる
 */
const MaxFileSizeContext = createContext(10)

export const MaxFileSizeProvider: FC<{ value: number; children: ReactNode }> = ({ value, children }) => (
  <MaxFileSizeContext.Provider value={value}>{children}</MaxFileSizeContext.Provider>
)

export const useMaxFileSizeMb = () => useContext(MaxFileSizeContext)
