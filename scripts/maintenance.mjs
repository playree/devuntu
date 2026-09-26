/**
 * メンテナンスモードを切り替える。
 *
 *   pnpm maintenance on|off|status
 *   docker compose run --rm tools maintenance on
 *
 * フラグはファイルの有無で持つ。DB に載せないのは、DB リストア中(DB が作り直されている間)でも
 * 遮断が効いている必要があるため。アプリ側は各プロセスが自分でファイルの有無を見に行く。
 *
 * フラグファイルの場所は `maintenance-flag.mjs` を参照。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseMaintenanceFile } from './maintenance-flag.mjs'

const usage = () => {
  console.error('Usage: node ./scripts/maintenance.mjs <on|off|status> [--file <path>]')
  console.error('Example: node ./scripts/maintenance.mjs on')
}

const main = () => {
  const args = process.argv.slice(2)
  const command = args.find((arg) => !arg.startsWith('--'))
  let file
  try {
    file = parseMaintenanceFile(args)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }

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
