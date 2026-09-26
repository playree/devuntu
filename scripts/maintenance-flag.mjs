/**
 * メンテナンスモードのフラグファイルの場所を決める。`maintenance.mjs` と `backup-all.mjs` が共有する。
 *
 * 既定のパスは cwd 相対の `config/maintenance`。アプリが見るのは環境変数 `MAINTENANCE_MODE_FILE`
 * (既定 `/app/config/maintenance`)で、これはコンテナ内のパスなのでこちらからはそのまま使えない。
 * compose.yaml がホストの `./config` を devuntu の `/app/config` へマウントしているため、
 * この2つは同じファイルを指す(別構成にした場合は `--file` で合わせる)。
 */
import path from 'node:path'

export const DEFAULT_MAINTENANCE_FILE = path.join(process.cwd(), 'config', 'maintenance')

/** `--file <path>` の値を絶対パスにしたもの。無ければ既定のパス */
export const parseMaintenanceFile = (args) => {
  const index = args.indexOf('--file')
  if (index < 0) {
    return DEFAULT_MAINTENANCE_FILE
  }
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error('--file にはフラグファイルのパスを指定してください')
  }
  return path.resolve(value)
}
