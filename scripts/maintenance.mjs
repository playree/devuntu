/**
 * メンテナンスモードを切り替える。
 *
 *   pnpm maintenance on|off|status
 *   docker compose run --rm tools maintenance on
 *
 * フラグはファイルの有無で持つ。DB に載せないのは、DB リストア中(DB が作り直されている間)でも
 * 遮断が効いている必要があるため。アプリ側は各プロセスが自分でファイルの有無を見に行く。
 *
 * 既定のパスは cwd 相対の `config/maintenance`。アプリが見るのは環境変数 `MAINTENANCE_MODE_FILE`
 * (既定 `/app/config/maintenance`)で、これはコンテナ内のパスなのでこちらからはそのまま使えない。
 * compose.yaml がホストの `./config` を devuntu の `/app/config` へマウントしているため、
 * この2つは同じファイルを指す(別構成にした場合は `--file` で合わせる)。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_FILE = path.join(process.cwd(), 'config', 'maintenance')

const usage = () => {
  console.error('Usage: node ./scripts/maintenance.mjs <on|off|status> [--file <path>]')
  console.error('Example: node ./scripts/maintenance.mjs on')
}

/** `--file <path>` の値。無ければ既定のパス */
const parseFile = (args) => {
  const index = args.indexOf('--file')
  if (index < 0) {
    return DEFAULT_FILE
  }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    console.error('--file にはフラグファイルのパスを指定してください')
    process.exit(1)
  }
  return path.resolve(value)
}

const main = () => {
  const args = process.argv.slice(2)
  const command = args.find((arg) => !arg.startsWith('--'))
  const file = parseFile(args)

  switch (command) {
    case 'on': {
      mkdirSync(path.dirname(file), { recursive: true })
      // 中身は使わないが、いつ入れたのか分からないと解除の判断ができないので時刻を書いておく
      writeFileSync(file, `${new Date().toISOString()}\n`)
      console.log(`maintenance mode: on (${file})`)
      break
    }
    case 'off': {
      rmSync(file, { force: true })
      console.log(`maintenance mode: off (${file})`)
      break
    }
    case 'status': {
      console.log(`maintenance mode: ${existsSync(file) ? 'on' : 'off'} (${file})`)
      break
    }
    default: {
      usage()
      process.exit(1)
    }
  }
}

main()
