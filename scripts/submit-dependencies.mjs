/**
 * `pnpm-lock.yaml` の依存を GitHub の Dependency submission API へ送る。
 *
 *   node scripts/submit-dependencies.mjs            # 送信(CI から実行)
 *   node scripts/submit-dependencies.mjs --dry-run  # 送らずに件数だけ表示
 *
 * pnpm v12 のロックファイルは YAML の2ドキュメント構成(1つ目が pnpm 本体、2つ目がアプリの依存)で、
 * GitHub の Dependency graph は1つ目しか読まない。アプリの依存を Dependabot alerts の対象にするため、
 * 2つ目のドキュメントから依存ツリーを組み立てて送る。
 *
 * 送信時は GitHub Actions の `GITHUB_TOKEN`(contents: write)と既定の環境変数を使う。
 */
import { readFileSync } from 'node:fs'
import { parseAllDocuments } from 'yaml'

const LOCKFILE = 'pnpm-lock.yaml'
const dryRun = process.argv.includes('--dry-run')

const lockfile = parseAllDocuments(readFileSync(LOCKFILE, 'utf8'))
  .map((doc) => doc.toJS())
  .find((doc) => doc?.importers?.['.']?.dependencies)
if (!lockfile) {
  console.error(`${LOCKFILE} にアプリの依存を持つドキュメントが見つかりません`)
  process.exit(1)
}

/** `1.2.3(react@19.0.0)` のようなピア依存の付記を落とす */
const stripPeers = (version) => version.replace(/\(.*$/, '')

/**
 * 依存名とロックファイル上のバージョンから snapshots のキーを返す。
 * `npm:` エイリアスは version 側に実体の `名前@バージョン` が入る。`link:` などはレジストリの
 * パッケージではないので対象外にする
 */
const toKey = (name, version) => {
  if (/^(link|file|workspace):/.test(version)) {
    return undefined
  }
  return /^@?[^@(]+@/.test(version) ? version : `${name}@${version}`
}

/** `@scope/name@1.2.3(...)` → `pkg:npm/%40scope/name@1.2.3` */
const toPurl = (key) => {
  const plain = stripPeers(key)
  const at = plain.lastIndexOf('@')
  const name = plain.slice(0, at).replace(/^@/, '%40')
  return `pkg:npm/${name}@${plain.slice(at + 1)}`
}

const childrenOf = (key) => {
  const snapshot = lockfile.snapshots?.[key] ?? {}
  return Object.entries({ ...snapshot.dependencies, ...snapshot.optionalDependencies })
    .map(([name, version]) => toKey(name, String(version)))
    .filter(Boolean)
}

const importer = lockfile.importers['.']
/** @type {Map<string, { package_url: string, relationship: string, scope: string, dependencies: Set<string> }>} */
const resolved = new Map()

/** runtime を先に辿り、development は runtime から届かないものだけに付く */
const walk = (deps, scope) => {
  const queue = Object.entries(deps ?? {})
    .map(([name, { version }]) => toKey(name, String(version)))
    .filter(Boolean)
  const direct = new Set(queue.map(toPurl))
  const visited = new Set()
  while (queue.length > 0) {
    const key = queue.shift()
    if (visited.has(key)) {
      continue
    }
    visited.add(key)
    const purl = toPurl(key)
    const children = childrenOf(key)
    const entry = resolved.get(purl) ?? {
      package_url: purl,
      relationship: 'indirect',
      scope,
      dependencies: new Set(),
    }
    if (direct.has(purl)) {
      entry.relationship = 'direct'
    }
    for (const child of children) {
      entry.dependencies.add(toPurl(child))
    }
    resolved.set(purl, entry)
    queue.push(...children)
  }
}

walk({ ...importer.dependencies, ...importer.optionalDependencies }, 'runtime')
walk(importer.devDependencies, 'development')

const entries = [...resolved.values()]
const count = (pred) => entries.filter(pred).length
console.log(
  `packages: ${entries.length} (direct ${count((e) => e.relationship === 'direct')}, ` +
    `runtime ${count((e) => e.scope === 'runtime')}, development ${count((e) => e.scope === 'development')})`,
)
if (dryRun) {
  process.exit(0)
}

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_RUN_ID, GITHUB_WORKFLOW, GITHUB_JOB } =
  process.env
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_REF) {
  console.error('GitHub Actions の環境変数(GITHUB_TOKEN など)がありません。確認だけなら --dry-run を付けてください')
  process.exit(1)
}

const snapshot = {
  version: 0,
  sha: GITHUB_SHA,
  ref: GITHUB_REF,
  job: { correlator: `${GITHUB_WORKFLOW}_${GITHUB_JOB}`, id: String(GITHUB_RUN_ID) },
  detector: {
    name: 'devuntu-pnpm-lock',
    version: '1.0.0',
    url: `https://github.com/${GITHUB_REPOSITORY}`,
  },
  scanned: new Date().toISOString(),
  manifests: {
    [LOCKFILE]: {
      name: LOCKFILE,
      file: { source_location: LOCKFILE },
      resolved: Object.fromEntries(
        entries.map((entry) => [entry.package_url, { ...entry, dependencies: [...entry.dependencies] }]),
      ),
    },
  },
}

const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/dependency-graph/snapshots`, {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
  },
  body: JSON.stringify(snapshot),
})
if (!res.ok) {
  console.error(`submission failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`submitted: ${JSON.stringify(await res.json())}`)
