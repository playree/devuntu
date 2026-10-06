'use client'

import { useTheme } from 'next-themes'

/**
 * 実際に表示しているテーマ(`light` / `dark`)。初回レンダーでは undefined。
 * next-themes の resolvedTheme はページ単位の強制(forcedTheme。印刷用ページのライト固定)を反映しないため、
 * 強制されていればそちらを返す
 */
export const useResolvedTheme = (): string | undefined => {
  const { resolvedTheme, forcedTheme } = useTheme()
  return forcedTheme ?? resolvedTheme
}
