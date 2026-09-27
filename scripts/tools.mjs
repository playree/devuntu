/**
 * 同梱スクリプトをサブコマンドで呼び出す。
 *
 *   docker compose run --rm tools setup-env
 *   docker compose run --rm tools db-backup
 *   docker compose run --rm tools db-restore backup/devuntu_YYYYMMDD_HHMMSS.dump
 *   docker compose run --rm tools s3-backup
 *   docker compose run --rm tools s3-restore backup/s3_YYYYMMDD_HHMMSS
 *   docker compose run --rm tools full-backup [--maintenance]
 *   docker compose run --rm tools full-restore backup/full_YYYYMMDD_HHMMSS
 *   docker compose run --rm tools maintenance on
 *
 * compose.yaml の使い捨てコンテナを tools 1本にまとめるための入口。
 * 呼び出し先の起動は `run-script.mjs` に集約している。
 */
import { t } from './messages.mjs'
import { spawnScript } from './run-script.mjs'

const COMMANDS = {
  'setup-env': 'setup-env/index.mjs',
  'db-backup': 'backup-db.mjs',
  'db-restore': 'restore-db.mjs',
  's3-backup': 'backup-s3.mjs',
  's3-restore': 'restore-s3.mjs',
  'full-backup': 'backup-all.mjs',
  'full-restore': 'restore-all.mjs',
  maintenance: 'maintenance.mjs',
}

const [command, ...rest] = process.argv.slice(2)

if (command === undefined) {
  process.stderr.write(t('tools_usage'))
  process.exit(1)
}

if (command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(t('tools_usage'))
  process.exit(0)
}

// プロトタイプ由来のプロパティ(toString など)を拾わないよう、自身のキーだけを見る
if (!Object.hasOwn(COMMANDS, command)) {
  process.stderr.write(`${t('tools_unknown_command', command)}\n\n${t('tools_usage')}`)
  process.exit(1)
}

const { child, exited } = spawnScript(COMMANDS[command], rest)

// tini が転送するシグナルはこのプロセスにしか届かないため、子へ渡す。
// 渡さないと `docker compose stop` などで入口だけが先に終わり、子が後始末(full-backup --maintenance の解除など)をできない
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

process.exit(await exited)
