/**
 * コマンド定義(YAML)を書いている最中の検証
 *
 * `command-def.ts` のスキーマは「読めるかどうか」しか答えない。ここはその結果を
 * **YAML テキスト上のどこが悪いのか**へ翻訳する。エディタが該当箇所へ直接印を付けられるようにするため。
 *
 * CodeMirror には依存させない。位置の解決は純粋関数で完結させ、単体テストで固定する。
 */

import { isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type YAMLMap } from 'yaml'
import type { z } from 'zod'
import { commandIssueMessage, scCommandDefInput, unknownKeyMessage } from './command-def'

/** 位置つきの指摘。オフセットはドキュメント先頭からの文字数 */
export type CommandDefIssue = {
  from: number
  to: number
  /** warning は「まだ書かれていない」もの。書いた内容が間違っているものは error */
  severity: 'error' | 'warning'
  message: string
}

type Located = Pick<CommandDefIssue, 'from' | 'to' | 'severity'> & {
  /** 問題のある値そのものを指せたか。指せていないときは文言へパスを補う */
  exact: boolean
}

type PathSegment = string | number

/**
 * YAML だけでは決まらない文脈。
 *
 * ここで検証するのはコマンド 1 件なので、定義ファイルの `target` は見えない。
 * 省略した場合はその文脈に依る検証を行わない(保存時にサーバーが同じ判定をする)。
 */
export type CommandDefLintContext = {
  /** ターゲットが `allowFreeInput: true` か。false なら `type: input` は書けない */
  allowFreeInput: boolean
}

/**
 * YAML テキストを読んで、構文エラーとスキーマ違反を位置つきで返す。
 *
 * 検証するのは**コマンド 1 件ぶん**の定義(`scCommandDefInput`)。定義ファイル全体ではない。
 */
export const lintCommandDefYaml = (text: string, context?: CommandDefLintContext): CommandDefIssue[] => {
  if (!text.trim()) {
    return []
  }

  const doc = parseDocument(text)
  const syntax: CommandDefIssue[] = [
    ...doc.errors.map((error) => ({
      from: error.pos[0],
      to: error.pos[1],
      severity: 'error' as const,
      message: error.message,
    })),
    ...doc.warnings.map((error) => ({
      from: error.pos[0],
      to: error.pos[1],
      severity: 'warning' as const,
      message: error.message,
    })),
  ]

  // 壊れた YAML にスキーマを当てると「未記入」の指摘で埋まる。直す順番は構文が先
  if (doc.errors.length > 0) {
    return normalize(syntax, text)
  }
  if (doc.contents === null) {
    return normalize(syntax, text)
  }

  let value: unknown
  try {
    value = doc.toJS()
  } catch (error) {
    // エイリアスの展開上限など、読めても JS へ起こせない場合
    const message = error instanceof Error ? error.message : String(error)
    return normalize([...syntax, { ...firstLine(text), severity: 'error', message }], text)
  }

  const free = context?.allowFreeInput === false ? locateFreeInputs(doc, text, value) : []

  const parsed = scCommandDefInput.safeParse(value)
  if (parsed.success) {
    return normalize([...syntax, ...free], text)
  }
  return normalize([...syntax, ...free, ...parsed.error.issues.flatMap((issue) => locateIssue(doc, text, issue))], text)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * フリー入力の指摘。
 *
 * 許可はターゲット側にあるため `scCommandDefInput` では判定できない。保存時にはサーバーが
 * ファイル全体を検証して断るが、それだけだと書き終えるまで気付けないので、
 * 画面が知っている許可をここで先に反映する。
 */
const locateFreeInputs = (doc: Document, text: string, value: unknown): CommandDefIssue[] => {
  const inputs = isRecord(value) ? value.inputs : undefined
  if (!Array.isArray(inputs)) {
    return []
  }
  return inputs.flatMap((input: unknown, index) => {
    if (!isRecord(input) || input.type !== 'input') {
      return []
    }
    const located = locatePath(doc, text, ['inputs', index, 'type'])
    return [
      {
        ...located,
        severity: 'error' as const,
        message: 'フリー入力を使うには、定義ファイルの target に allowFreeInput: true が要る',
      },
    ]
  })
}

/** issue 1 件を位置つきへ。未知キーはキーごとに分けて、それぞれの位置を指す */
const locateIssue = (doc: Document, text: string, issue: z.core.$ZodIssue): CommandDefIssue[] => {
  const path = issue.path as PathSegment[]
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => {
      const located = locateKey(doc, text, path, key)
      const message = unknownKeyMessage(key)
      return { ...located, message: located.exact ? message : withPath([...path, key], message) }
    })
  }
  const located = locatePath(doc, text, path)
  return [{ ...located, message: located.exact ? commandIssueMessage(issue) : describe(issue, path) }]
}

/**
 * 値そのものを指せなかった issue の文言。
 *
 * 印の位置が「その辺り」までしか言えないので、代わりにパスを文へ戻す。
 * 書かれていない項目は zod の既定文(英語で「undefined を受け取った」)だけでは何が足りないのか読めないため、
 * このモジュールで言い直す。
 */
const describe = (issue: z.core.$ZodIssue, path: PathSegment[]): string => {
  if (path.length === 0) {
    return commandIssueMessage(issue)
  }
  if (issue.code === 'invalid_type') {
    return `必須の項目 ${path.join('.')} が書かれていない`
  }
  return withPath(path, commandIssueMessage(issue))
}

const withPath = (path: PathSegment[], message: string): string => `${path.join('.')}: ${message}`

/**
 * 未知キーの位置。
 *
 * この issue の `path` は**キーを持つオブジェクトまで**しか無く、キー名は `keys` にしか入らない。
 * 値ではなくキーの側を指したいので、親のマップから対応する Pair を引き直す。
 */
const locateKey = (doc: Document, text: string, path: PathSegment[], key: string): Located => {
  const parent = nodeAtPath(doc, path)
  if (parent.matched === path.length && isMap(parent.node)) {
    const pair = findPair(parent.node, key)
    const keyRange = isNode(pair?.key) ? pair.key.range : null
    if (keyRange) {
      const valueEnd = isNode(pair?.value) ? (pair.value.range?.[1] ?? keyRange[1]) : keyRange[1]
      return { from: keyRange[0], to: Math.max(keyRange[1], valueEnd), severity: 'error', exact: true }
    }
  }
  return locatePath(doc, text, path)
}

/**
 * `issue.path` を文字位置へ。
 *
 * 途中で辿れなくなる(= まだ書かれていない項目)ことがあるので、そのときは到達できた一番深い所の
 * **見出し行だけ**を指す。ブロック全体を指すと画面が真っ赤になるうえ、直す場所も分からない。
 * 指摘そのものは落とさない。黙って消えるのが一番たちが悪い。
 */
const locatePath = (doc: Document, text: string, path: PathSegment[]): Located => {
  const { node, matched } = nodeAtPath(doc, path)
  const range = node?.range
  if (!range) {
    return { ...firstLine(text), severity: 'warning', exact: false }
  }
  if (matched < path.length) {
    return { ...lineAt(text, range[0]), severity: 'warning', exact: false }
  }
  if (range[0] < range[1]) {
    // range[2] は後ろのコメントや改行まで含むので使わない
    return { from: range[0], to: range[1], severity: 'error', exact: true }
  }
  // `timeoutSec:` のようにキーだけ書いた状態。幅が無いと印が描かれないのでキーまで広げる
  return { ...widenToKey(doc, path, range[1]), severity: 'warning', exact: true }
}

const widenToKey = (doc: Document, path: PathSegment[], valueEnd: number): Pick<Located, 'from' | 'to'> => {
  const last = path.at(-1)
  const parent = nodeAtPath(doc, path.slice(0, -1))
  if (typeof last === 'string' && parent.matched === path.length - 1 && isMap(parent.node)) {
    const keyRange = keyRangeOf(parent.node, last)
    if (keyRange) {
      return { from: keyRange[0], to: Math.max(keyRange[1], valueEnd) }
    }
  }
  return { from: valueEnd, to: valueEnd }
}

/**
 * パスを辿って届いた所までを返す。
 *
 * `Document.getIn` を使わないのは、途中で欠けたときに**どこまで辿れたか**が取れないため。
 * 「書いた内容が違う」のか「まだ書かれていない」のかは、その到達段数でしか区別できない。
 */
const nodeAtPath = (doc: Document, path: PathSegment[]): { node: Node | null; matched: number } => {
  let current: unknown = doc.contents
  let matched = 0
  for (const segment of path) {
    let next: unknown
    if (isMap(current)) {
      next = findPair(current, segment)?.value
    } else if (isSeq(current)) {
      next = current.items[Number(segment)]
    }
    if (next === undefined || next === null) {
      break
    }
    current = next
    matched += 1
  }
  return { node: isNode(current) ? current : null, matched }
}

const findPair = (map: YAMLMap, key: PathSegment): Pair<unknown, unknown> | undefined =>
  map.items.find((item) => isScalar(item.key) && String(item.key.value) === String(key))

const keyRangeOf = (map: YAMLMap, key: PathSegment): [number, number] | null => {
  const pair = findPair(map, key)
  const range = isNode(pair?.key) ? pair.key.range : null
  return range ? [range[0], range[1]] : null
}

/** offset を含む 1 行の範囲 */
const lineAt = (text: string, offset: number): Pick<Located, 'from' | 'to'> => {
  const start = text.lastIndexOf('\n', Math.max(offset - 1, 0)) + 1
  const end = text.indexOf('\n', start)
  return { from: start, to: end === -1 ? text.length : end }
}

/** 位置を絞り込めなかったときの受け皿。最初に中身のある行を指す */
const firstLine = (text: string): Pick<Located, 'from' | 'to'> => {
  const index = text.search(/\S/)
  return lineAt(text, index < 0 ? 0 : index)
}

/** 範囲を文書内へ収め、幅 0 の指摘に 1 文字ぶんの幅を持たせる(幅が無いと印が描かれない) */
const normalize = (issues: (CommandDefIssue & { exact?: boolean })[], text: string): CommandDefIssue[] =>
  issues.map(({ exact: _exact, ...issue }) => {
    const from = Math.min(Math.max(issue.from, 0), text.length)
    const to = Math.min(Math.max(issue.to, from), text.length)
    if (from < to) {
      return { ...issue, from, to }
    }
    if (to < text.length) {
      return { ...issue, from, to: to + 1 }
    }
    return { ...issue, from: Math.max(from - 1, 0), to }
  })
