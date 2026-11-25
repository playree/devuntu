/**
 * Wiki ページの階層の純粋関数
 *
 * スペース内のページを `{ id, parentId }` の一覧で受け取り、深さ・部分木の高さ・子孫・兄弟の並びを求める。
 * 構造を変える書き込み(作成・移動・削除)はスペース行をロックしてから一覧を読むので、ここでは一貫した木を前提にする。
 */

import { isSameOrder } from '../list-compare'

export type WikiTreeNode = { id: string; parentId: string | null }

export type WikiTreeIndex = {
  byId: Map<string, WikiTreeNode>
  children: Map<string | null, string[]>
}

export const indexWikiTree = (nodes: readonly WikiTreeNode[]): WikiTreeIndex => {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string | null, string[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId)
    if (siblings) {
      siblings.push(node.id)
    } else {
      children.set(node.parentId, [node.id])
    }
  }
  return { byId, children }
}

/** 先祖の id(近い順)。壊れた木で無限に回らないよう、一度通った id で止める */
export const ancestorIds = (index: WikiTreeIndex, id: string): string[] => {
  const result: string[] = []
  const seen = new Set([id])
  let parentId = index.byId.get(id)?.parentId ?? null
  while (parentId !== null && !seen.has(parentId)) {
    result.push(parentId)
    seen.add(parentId)
    parentId = index.byId.get(parentId)?.parentId ?? null
  }
  return result
}

/** 深さ。スペース直下が 1 */
export const depthOf = (index: WikiTreeIndex, id: string): number => ancestorIds(index, id).length + 1

/** 子孫の id(自分は含まない)。幅優先 */
export const descendantIds = (index: WikiTreeIndex, id: string): string[] => {
  const result: string[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const child of index.children.get(queue.shift()!) ?? []) {
      if (!seen.has(child)) {
        seen.add(child)
        result.push(child)
        queue.push(child)
      }
    }
  }
  return result
}

/** 部分木の高さ。子が無ければ 1 */
export const subtreeHeight = (index: WikiTreeIndex, id: string): number => {
  let height = 1
  for (const descendant of descendantIds(index, id)) {
    // 子孫の深さは「先祖をたどって id に着くまでの段数 + 1」
    const steps = ancestorIds(index, descendant).indexOf(id) + 1
    height = Math.max(height, steps + 1)
  }
  return height
}

/** `candidateId` が `id` 自身か、その子孫か(移動先の親に選ぶと循環する) */
export const isSelfOrDescendant = (index: WikiTreeIndex, id: string, candidateId: string): boolean =>
  candidateId === id || ancestorIds(index, candidateId).includes(id)

/**
 * 兄弟の並びに `id` を `position`(0 始まり)へ差し込んだ並び。`id` が既に兄弟にいれば一度外してから入れる。
 * `position` が無い・範囲外なら末尾(負なら先頭)
 */
export const placeInSiblings = (siblingIds: readonly string[], id: string, position?: number): string[] => {
  const rest = siblingIds.filter((siblingId) => siblingId !== id)
  const at = position === undefined ? rest.length : Math.min(Math.max(position, 0), rest.length)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** 移動先は先頭(null)・兄弟の直後・末尾(undefined)。指定の兄弟がもういなければ末尾にする */
export const planWikiMove = (
  index: WikiTreeIndex,
  pageId: string,
  currentParentId: string | null,
  parentId: string | null,
  requestedAfterId: string | null | undefined,
) => {
  const siblingIds = index.children.get(parentId) ?? []
  const otherIds = siblingIds.filter((id) => id !== pageId)
  const afterIndex = requestedAfterId == null ? -1 : otherIds.indexOf(requestedAfterId)
  const position = requestedAfterId === null ? 0 : afterIndex < 0 ? undefined : afterIndex + 1
  const afterId = requestedAfterId === null ? null : afterIndex < 0 ? undefined : otherIds[afterIndex]
  return {
    afterId,
    isUnchanged: parentId === currentParentId && isSameOrder(placeInSiblings(siblingIds, pageId, position), siblingIds),
  }
}

export type NestedWikiNode<U> = U & { children?: NestedWikiNode<U>[]; childCount?: number }

/**
 * 平らな木(兄弟の並び順)を入れ子にする。`rootId` の子孫を返し(null ならスペース直下から)、`rootId` 自身は含めない。
 * `depth` 段より深い子は持たせず、子の数(`childCount`)だけを添える
 */
export const nestWikiTree = <T extends WikiTreeNode, U extends object>(
  rows: readonly T[],
  toNode: (row: T) => U,
  opts: { rootId: string | null; depth?: number },
): NestedWikiNode<U>[] => {
  const index = indexWikiTree(rows)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const seen = new Set<string>(opts.rootId === null ? [] : [opts.rootId])
  const build = (parentId: string | null, level: number): NestedWikiNode<U>[] =>
    (index.children.get(parentId) ?? []).flatMap((id) => {
      const row = byId.get(id)
      // 壊れた木で無限に回らないよう、一度通った id は飛ばす
      if (!row || seen.has(id)) {
        return []
      }
      seen.add(id)
      const node = toNode(row)
      const childCount = index.children.get(id)?.length ?? 0
      if (childCount === 0) {
        return [node]
      }
      if (opts.depth !== undefined && level >= opts.depth) {
        return [{ ...node, childCount }]
      }
      return [{ ...node, children: build(id, level + 1) }]
    })
  return build(opts.rootId, 1)
}

export type DeletedWikiNode = { id: string; parentId: string | null; order: number; number: number }

/**
 * 削除済みのページを元の親子関係の前順(親 → 子)に並べ、削除済み同士の段数(0 始まり)を添える。
 * 上から順に復元すれば親が先に戻り、子も元の親の下へ戻る。
 * 親が一覧に無いものを先頭の段とし、入力の順(削除した日時の新しい順)を保つ。兄弟は元の並び順
 */
export const arrangeDeletedWikiPages = <T extends DeletedWikiNode>(rows: readonly T[]): (T & { depth: number })[] => {
  const ids = new Set(rows.map(({ id }) => id))
  const roots: T[] = []
  const children = new Map<string, T[]>()
  for (const row of rows) {
    if (row.parentId === null || row.parentId === row.id || !ids.has(row.parentId)) {
      roots.push(row)
    } else {
      const siblings = children.get(row.parentId)
      if (siblings) {
        siblings.push(row)
      } else {
        children.set(row.parentId, [row])
      }
    }
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.order - b.order || a.number - b.number)
  }
  const result: (T & { depth: number })[] = []
  const seen = new Set<string>()
  const visit = (row: T, depth: number) => {
    if (seen.has(row.id)) {
      return
    }
    seen.add(row.id)
    result.push({ ...row, depth })
    for (const child of children.get(row.id) ?? []) {
      visit(child, depth + 1)
    }
  }
  for (const row of roots) {
    visit(row, 0)
  }
  // 親をたどっても先頭の段に着かない(循環した)行は、先頭の段として末尾に足す
  for (const row of rows) {
    visit(row, 0)
  }
  return result
}

/**
 * 一覧の `index` の行と一緒に戻る配下(一覧で後に続く、段の深い行)。
 * 復元済みの行は親子がつながらなくなる(サーバーは削除済みの親をたどって配下を探す)ので、その行と配下は含めない
 */
export const restorableDescendantsAt = <T extends { id: string; depth: number }>(
  pages: readonly T[],
  index: number,
  restored: ReadonlySet<string>,
): T[] => {
  const result: T[] = []
  let skipBelow: number | undefined
  for (const page of pages.slice(index + 1)) {
    if (page.depth <= pages[index].depth) {
      break
    }
    if (skipBelow !== undefined && page.depth > skipBelow) {
      continue
    }
    skipBelow = undefined
    if (restored.has(page.id)) {
      skipBelow = page.depth
    } else {
      result.push(page)
    }
  }
  return result
}
