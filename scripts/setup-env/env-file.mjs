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

/**
 * 引用符で囲まなくても曖昧にならない値か。
 *
 * `$` を含めているのは、godotenv が未引用の値へ補間をかけるため。`PASS=pa$HOME` は
 * ホスト側の `$HOME` へ置き換わり、設定した本人が気づけないまま別の値になる。
 */
const isBareValue = (value) => !/[\s#$'"]/.test(value)

/**
 * env ファイルへ書き出す値を引用する。
 *
 * 生成したファイルは `util.parseEnv` と Docker Compose(godotenv 系)の両方に読まれるため、
 * 両者で解釈が一致する書き方だけを使う。実測した差異は次のとおり。
 *
 * | 出力          | godotenv                  | parseEnv |
 * | ------------- | ------------------------- | -------- |
 * | `V=pa$HOME`   | `pa/home/...`(補間される) | `pa$HOME` |
 * | `V='pa$HOME'` | `pa$HOME`                 | `pa$HOME` |
 * | `V='pa\ss'`   | `pa\ss`                   | `pa\ss`  |
 * | `V='pa\'`     | ファイル全体が読めない     | `pa\`    |
 *
 * ダブルクォートは godotenv だけが補間とエスケープを解釈するので使わない。
 * 末尾のバックスラッシュは godotenv がシングルクォートのエスケープとみなし、
 * **その行以降を含む env ファイル全体が読めなくなる**ため書けない。
 * 途中のバックスラッシュは両者で一致するので許可する。
 */
export const quoteEnvValue = (value) => {
  const text = String(value)
  if (text.includes('\n') || text.includes('\r')) {
    throw new Error('改行を含む値は env ファイルへ書けません')
  }
  if (text.includes("'")) {
    throw new Error("シングルクォート(')を含む値は env ファイルへ書けません")
  }
  if (text.endsWith('\\')) {
    throw new Error('バックスラッシュで終わる値は env ファイルへ書けません')
  }
  if (text === '' || isBareValue(text)) {
    return text
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
 * `values` に値が無いキーは行を出さない(未設定として扱う)。
 * `sections` のどこにも属さないキーは末尾へ退避する。利用者が独自に足した値や、
 * アプリ側で使われなくなった値を黙って落とさないため。
 *
 * @param {object} params
 * @param {string[]} [params.header] 先頭へ置くコメント行
 * @param {{ title: string, keys: string[] }[]} params.sections
 * @param {Record<string, string | boolean | number | undefined>} params.values
 * @param {string} [params.extrasTitle] sections に無いキーをまとめる見出し
 * @returns {string}
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

/** 画面へ出してはいけないと分かっているキー */
const SECRET_KEYS = new Set([
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'SENDGRID_API_KEY',
  'SMTP_PASS',
  'GOOGLE_CLIENT_SECRET',
  'SLACK_CLIENT_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'GITHUB_WEBHOOK_SECRET',
  'MAIN_DEVUNTU_CLIENT_SECRET',
  'LINODE_PERSONAL_ACCESS_TOKEN',
  'VAPID_PRIVATE_KEY',
  'S3_SECRET_ACCESS_KEY',
  'POSTGRES_PASSWORD',
])

/** 秘密らしい名前。将来キーが増えたときに列挙漏れで平文が出ないようにする */
const SECRET_NAME = /SECRET|TOKEN|PASSWORD|_PASS$|CREDENTIAL/i

/**
 * 画面へ出すときにマスクすべきキーか。
 *
 * `managedKeys` に無いキー(利用者が独自に足した値)も一律マスクする。
 * 列挙に頼ると `MY_API_KEY` のような名前を取りこぼすため、安全側へ倒している。
 * 代わりに無害な未知キーもマスクされるが、キー名自体はプレビューの手前で列挙している。
 *
 * @param {string} key
 * @param {Set<string>} managedKeys このスクリプトが定義として持っているキー
 * @returns {boolean}
 */
export const isSecretKey = (key, managedKeys) => SECRET_KEYS.has(key) || !managedKeys.has(key) || SECRET_NAME.test(key)

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
