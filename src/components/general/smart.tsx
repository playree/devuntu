'use client'
import { createContext, FC, ReactNode, useContext } from 'react'

/**
 * - 'smart'     : スマートサイズ + エラーメッセージ表示領域を確保しない
 * - 'smartForm' : スマートサイズ + エラーメッセージ表示領域を確保する
 * - false       : 標準サイズ + エラーメッセージ表示領域を確保する
 */
export type SmartMode = 'smart' | 'smartForm' | false

const SmartContext = createContext<SmartMode>(false)

/**
 * isSmart / isSmartForm の解決。優先度は isSmart > isSmartForm > 親からの継承(既定false)。
 * useContextは必ず先に無条件で呼ぶ(条件付き呼び出しを避けるため)。
 */
const resolveSmartMode = (inherited: SmartMode, isSmart?: boolean, isSmartForm?: boolean): SmartMode => {
  if (isSmart !== undefined) {
    return isSmart ? 'smart' : false
  }
  if (isSmartForm !== undefined) {
    return isSmartForm ? 'smartForm' : false
  }
  return inherited
}

export const useSmartMode = (isSmart?: boolean, isSmartForm?: boolean): SmartMode => {
  const inherited = useContext(SmartContext)
  return resolveSmartMode(inherited, isSmart, isSmartForm)
}

/** isCompact: サイズ圧縮の有無。hasErrorArea: エラーメッセージ表示領域を確保するか('smart'のときだけfalse) */
export const useSmart = (isSmart?: boolean, isSmartForm?: boolean) => {
  const mode = useSmartMode(isSmart, isSmartForm)
  return { isCompact: mode !== false, hasErrorArea: mode !== 'smart' }
}

/** エラーメッセージ表示領域を持たない部品用。isCompactの解決だけが必要な場合はこちらを使う */
export const useIsSmart = (isSmart?: boolean): boolean => useSmart(isSmart).isCompact

/** 配下のパーツへisSmart/isSmartFormを伝播させる。両方無指定ならさらに上の親の値を引き継ぐ */
export const SmartProvider: FC<{ isSmart?: boolean; isSmartForm?: boolean; children: ReactNode }> = ({
  isSmart,
  isSmartForm,
  children,
}) => {
  const mode = useSmartMode(isSmart, isSmartForm)
  return <SmartContext.Provider value={mode}>{children}</SmartContext.Provider>
}
