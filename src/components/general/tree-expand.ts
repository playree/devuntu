/**
 * ツリーで `selectedId` を見えるようにするために開く項目。先祖(近い順)と、`withSelf` なら自分。
 * 親を辿って循環したら止める
 */
export const treeIdsToExpand = (
  byId: ReadonlyMap<string, { parentId: string | null }>,
  selectedId: string | null | undefined,
  withSelf: boolean,
): string[] => {
  if (!selectedId) {
    return []
  }
  const ids = withSelf ? [selectedId] : []
  const seen = new Set([selectedId])
  for (let id = byId.get(selectedId)?.parentId; id && !seen.has(id); id = byId.get(id)?.parentId) {
    seen.add(id)
    ids.push(id)
  }
  return ids
}
