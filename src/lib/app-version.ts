import pkg from '../../package.json'
import { envu } from './env-util'
import { logger } from './logger'
import { prisma } from './prisma'

/**
 * 起動中のアプリバージョンをDBに記録する。
 *
 * 同一バージョンは upsert して updatedAt(最終起動日時)を更新するため、
 * createdAt が「そのバージョンを最初に起動した日時」になる。
 * これにより「このDBがどのバージョンでいつ利用されていたか」を後から追跡できる。
 *
 * 観測目的の処理なので、DB未接続やマイグレーション未適用でもサーバー起動を止めないよう
 * 例外はログのみで飲み込む。
 */
export const recordAppVersion = async () => {
  const version = pkg.version
  const buildNo = envu.server.BUILD_NO
  try {
    await prisma.appVersion.upsert({
      where: { version },
      // buildNo を明示的に渡すことで @updatedAt が確実に更新される
      update: { buildNo },
      create: { version, buildNo },
    })
    logger.info({ version, buildNo }, 'アプリバージョンをDBに記録しました')
  } catch (err) {
    logger.error({ err, version, buildNo }, 'アプリバージョンの記録に失敗しました')
  }
}
