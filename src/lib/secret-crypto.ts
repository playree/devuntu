/**
 * DB に保存する秘密値の暗号化(サーバー専用)
 *
 * 鍵は BETTER_AUTH_SECRET を使う(better-auth が Jwks の秘密鍵を暗号化するのと同じ方式)。
 * BETTER_AUTH_SECRET を変えると復号できなくなるので、保存した値は入れ直しが必要になる。
 */

import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { envu } from './env-util'
import { logger } from './logger'

export const encryptSecret = async (plain: string): Promise<string> =>
  symmetricEncrypt({ key: envu.server.BETTER_AUTH_SECRET, data: plain })

/** 復号する。鍵が変わった・壊れているなどで復号できなければ null */
export const decryptSecret = async (encrypted: string): Promise<string | null> => {
  try {
    return await symmetricDecrypt({ key: envu.server.BETTER_AUTH_SECRET, data: encrypted })
  } catch (error) {
    logger.warn({ error }, 'secret decrypt failed')
    return null
  }
}
