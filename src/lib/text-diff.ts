/**
 * 行単位のテキスト差分(LCS)
 *
 * 履歴の表示用。前後の一致行を先に切り落としてから LCS を取り、
 * 残りの行数の積が大きすぎるときは「全行削除 + 全行追加」に倒して計算量を抑える。
 */

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string }
export type FoldedDiffLine = DiffLine | { op: 'skip'; count: number }

/** LCS の表の大きさの上限(行数の積) */
const MAX_LCS_CELLS = 250_000

const lcsDiff = (a: string[], b: string[]): DiffLine[] => {
  const width = b.length + 1
  // table[i * width + j] = a[i:] と b[j:] の LCS の長さ
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ op: 'same', text: a[i] })
      i++
      j++
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      lines.push({ op: 'del', text: a[i++] })
    } else {
      lines.push({ op: 'add', text: b[j++] })
    }
  }
  return [
    ...lines,
    ...a.slice(i).map((text) => ({ op: 'del' as const, text })),
    ...b.slice(j).map((text) => ({ op: 'add' as const, text })),
  ]
}

export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split('\n')
  const b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle =
    midA.length * midB.length > MAX_LCS_CELLS
      ? [...midA.map((text) => ({ op: 'del' as const, text })), ...midB.map((text) => ({ op: 'add' as const, text }))]
      : lcsDiff(midA, midB)
  return [
    ...a.slice(0, start).map((text) => ({ op: 'same' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ op: 'same' as const, text })),
  ]
}

/** 変更から `context` 行より離れた一致行を `skip` にまとめる */
export const foldDiffLines = (lines: DiffLine[], context = 2): FoldedDiffLine[] => {
  const near = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.op === 'same') {
      return
    }
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) {
      near[k] = true
    }
  })
  const folded: FoldedDiffLine[] = []
  lines.forEach((line, index) => {
    if (line.op !== 'same' || near[index]) {
      folded.push(line)
      return
    }
    const last = folded.at(-1)
    if (last?.op === 'skip') {
      last.count++
    } else {
      folded.push({ op: 'skip', count: 1 })
    }
  })
  return folded
}
