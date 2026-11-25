/**
 * 文字列(ID など)の列の比較(サーバー / クライアント共用)
 */

/** 並びを問わず、同じ値の集合か(重複は畳む) */
export const isSameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a)
  const setB = new Set(b)
  return setA.size === setB.size && [...setB].every((id) => setA.has(id))
}

/** 同じ並びの列か */
export const isSameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => b[i] === id)
