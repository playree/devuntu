'use client'
import { createContext, FC, ReactNode, useContext } from 'react'

const SmartContext = createContext(false)

/**
 * isSmart(コンパクト表示)の解決。
 * 明示指定されたpropを優先し、無指定なら親のSmartProviderから継承する(既定はfalse)。
 * `isSmart ?? useContext(...)` と書くと ?? が右辺を短絡してフックが条件付き呼び出しになるため、
 * useContextは必ず先に無条件で呼ぶ。
 */
export const useIsSmart = (isSmart?: boolean) => {
  const inherited = useContext(SmartContext)
  return isSmart ?? inherited
}

/** 配下のパーツへisSmartを伝播させる。無指定ならさらに上の親の値を引き継ぐ */
export const SmartProvider: FC<{ isSmart?: boolean; children: ReactNode }> = ({ isSmart, children }) => {
  const value = useIsSmart(isSmart)
  return <SmartContext.Provider value={value}>{children}</SmartContext.Provider>
}
