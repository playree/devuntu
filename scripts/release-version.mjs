/**
 * `package.json` の version がリリース済みかを、remote の git タグで判定する。
 *
 *   pnpm release:version            状態を JSON で出す
 *   pnpm release:version --check    リリース済み(または最新リリースより古い)なら exit 1
 *                                   `--allow-tag-at <sha>` を付けると、タグがその commit を指す場合は通す(リリースの commit から edge を作り直すとき)
 *   pnpm release:version --bump     リリース済み(または古い)なら、次のパッチへ package.json を書き換える
 *
 * リリースは GitHub Release の公開で作られる `v<version>` タグ、stable は git タグ `stable` が正。
 * ローカルのタグは fetch していないと古いままなので、毎回 `git ls-remote` で remote を見る。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+$/
const VERSION_TAG = /^refs\/tags\/v(\d+\.\d+\.\d+)$/
const STABLE_TAG = 'refs/tags/stable'

/** `x.y.z` を比較する。a が大きければ正 */
export const compareVersion = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i]
    }
  }
  return 0
}

export const nextPatch = (version) => {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

/**
 * `git ls-remote --tags` の出力から、リリースタグ(commit 付き)と stable の commit を取り出す。
 * 注釈付きタグは `^{}` の行が指す先の commit を使う
 */
export const parseRemoteTags = (output) => {
  const refs = new Map()
  for (const line of output.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/)
    if (!sha || !ref) {
      continue
    }
    if (ref.endsWith('^{}')) {
      refs.set(ref.slice(0, -3), sha)
    } else if (!refs.has(ref)) {
      refs.set(ref, sha)
    }
  }
  const releases = []
  for (const [ref, sha] of refs) {
    const m = VERSION_TAG.exec(ref)
    if (m) {
      releases.push({ version: m[1], sha })
    }
  }
  releases.sort((a, b) => compareVersion(b.version, a.version))
  return { releases, stableSha: refs.get(STABLE_TAG) }
}

/**
 * version の状態。`bumpTo` はリリース済み、または最新リリースより古いときに上げる先(それ以外は null)
 */
export const releaseStatus = (version, { releases, stableSha }) => {
  if (!VERSION.test(version)) {
    throw new Error(`package.json version must be x.y.z: ${version}`)
  }
  const latest = releases[0]?.version ?? null
  const releasedSha = releases.find((r) => r.version === version)?.sha ?? null
  const released = releasedSha !== null
  const outdated = latest !== null && compareVersion(version, latest) < 0
  const stable = releases.find((r) => r.sha === stableSha)?.version ?? null
  const bumpTo = released || outdated ? nextPatch(outdated ? latest : version) : null
  return { version, released, releasedSha, outdated, latest, stable, bumpTo }
}

/** `--check` を通すか。リリース済みでも、タグが allowSha を指していればそのリリース自体の作り直しとみなす */
export const passesCheck = (status, allowSha) =>
  !status.bumpTo || (status.released && allowSha !== undefined && status.releasedSha === allowSha)

/** package.json の文字列の `"version"` だけを書き換える(他の行の書式は保つ) */
export const replaceVersion = (text, version) => {
  const replaced = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`)
  if (replaced === text) {
    throw new Error('"version" not found in package.json')
  }
  return replaced
}

const main = (args) => {
  const pkgPath = path.join(process.cwd(), 'package.json')
  const pkgText = readFileSync(pkgPath, 'utf8')
  const { version } = JSON.parse(pkgText)
  const output = execFileSync('git', ['ls-remote', '--tags', 'origin'], { encoding: 'utf8' })
  const status = releaseStatus(version, parseRemoteTags(output))

  if (args.includes('--check')) {
    const allowIndex = args.indexOf('--allow-tag-at')
    const allowSha = allowIndex < 0 ? undefined : args[allowIndex + 1]
    if (!passesCheck(status, allowSha)) {
      const reason = status.released ? `v${version} is already released` : `${version} is older than v${status.latest}`
      process.stderr.write(`${reason}. Run \`pnpm release:version --bump\` to start ${status.bumpTo}.\n`)
      return 1
    }
    process.stdout.write(status.released ? `v${version} points to ${allowSha}\n` : `${version} is not released yet\n`)
    return 0
  }

  if (args.includes('--bump')) {
    if (!status.bumpTo) {
      process.stdout.write(`${version} is not released yet. Nothing to bump\n`)
      return 0
    }
    writeFileSync(pkgPath, replaceVersion(pkgText, status.bumpTo))
    process.stdout.write(`package.json: ${version} -> ${status.bumpTo}\n`)
    return 0
  }

  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)))
}
