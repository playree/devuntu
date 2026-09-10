/**
 * env ファイルの読み書きに使う純関数群。
 *
 * fs も process も触らないため、`tests/scripts/setup-env/env-file.test.ts` から
 * そのまま検証できる。副作用は `index.mjs` 側へ寄せている。
 */
import { parseEnv } from 'node:util'

/**
 * env ファイルの内容をキーと値の組へ分解する。
 *
 * `util.parseEnv` は Stability 1.1(Active development)なので、受理してほしい書式は
 * テストでピン留めしている。Node の更新で挙動が変わったときに、利用者の環境ではなく
 * テストが落ちるようにするのが目的。
 */
export const parseEnvFile = (content) => parseEnv(content)

/** 引用符で囲まなくても曖昧にならない値か */
const isBareValue = (value) => !/[\s#'"]/.test(value)

/**
 * env ファイルへ書き出す値を引用する。
 *
 * 生成したファイルは `util.parseEnv` と Docker Compose(godotenv 系)の両方に読まれる。
 * ダブルクォートは godotenv では `${VAR}` の補間とエスケープ解釈が起きるが `parseEnv` では
 * 起きないため、両者で解釈が一致するシングルクォートだけを使う。
 * シングルクォートを含む値は囲めないので、呼び出し側で入力し直させる。
 */
export const quoteEnvValue = (value) => {
  const text = String(value)
  if (text.includes('\n') || text.includes('\r')) {
    throw new Error('改行を含む値は env ファイルへ書けません')
  }
  if (text === '' || isBareValue(text)) {
    return text
  }
  if (text.includes("'")) {
    throw new Error("シングルクォート(')を含む値は env ファイルへ書けません")
  }
  return `'${text}'`
}

/** 真偽値は `getEnvBoolean` が `true` / `false` 以外を弾くため、書き出し時に正規化する */
const normalize = (value) => {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

/**
 * セクションコメント付きの env ファイル本文を組み立てる。
 *
 * `sections` は `{ title, keys }` の配列。`values` に値が無いキーは行を出さない(未設定として扱う)。
 * `sections` のどこにも属さないキーは末尾へ退避する。利用者が独自に足した値や、
 * アプリ側で使われなくなった値を黙って落とさないため。
 */
export const serializeEnv = ({ header = [], sections, values, extrasTitle = 'その他' }) => {
  const lines = header.map((line) => `# ${line}`)
  const known = new Set()

  for (const section of sections) {
    const body = []
    for (const key of section.keys) {
      known.add(key)
      const value = values[key]
      if (value === undefined || value === null || value === '') {
        continue
      }
      body.push(`${key}=${quoteEnvValue(normalize(value))}`)
    }
    if (body.length === 0) {
      continue
    }
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(`# ${section.title}`, ...body)
  }

  const extras = Object.keys(values).filter((key) => !known.has(key) && values[key] !== undefined)
  if (extras.length > 0) {
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(`# ${extrasTitle}`)
    for (const key of extras) {
      lines.push(`${key}=${quoteEnvValue(normalize(values[key]))}`)
    }
  }

  return `${lines.join('\n')}\n`
}

/** 秘密値を画面へ出すための伏せ字。短い値は全体を隠す */
export const maskSecret = (value) => {
  const text = String(value ?? '')
  if (text === '') {
    return ''
  }
  if (text.length <= 8) {
    return '*'.repeat(text.length)
  }
  return `${text.slice(0, 3)}${'*'.repeat(text.length - 6)}${text.slice(-3)}`
}

/** 既存ファイルとの差分。値は含めない(画面へ秘密を出さないため) */
export const diffEnv = (before, after) => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const added = []
  const changed = []
  const removed = []
  for (const key of [...keys].sort()) {
    const hasBefore = before[key] !== undefined
    const hasAfter = after[key] !== undefined && after[key] !== ''
    if (!hasBefore && hasAfter) {
      added.push(key)
    } else if (hasBefore && !hasAfter) {
      removed.push(key)
    } else if (hasBefore && hasAfter && normalize(before[key]) !== normalize(after[key])) {
      changed.push(key)
    }
  }
  return { added, changed, removed }
}
