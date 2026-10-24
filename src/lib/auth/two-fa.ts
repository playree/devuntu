import { envu } from '../env-util'

/**
 * 2FA 必須の運用で、まだ 2FA を設定していない利用者か。
 *
 * パスワードでサインインすると 2FA 未設定でも完全なセッションが発行される。
 * 画面は Proxy が 2FA の設定へ誘導するが、Server Action・API・OAuth の認可は Proxy を通らないため、
 * それぞれの入口でもこの判定で止める。
 */
export const requiresTwoFaSetup = (user: { twoFactorEnabled?: boolean | null }): boolean =>
  envu.server.TWO_FA_REQUIRED && !envu.server.DISABLE_PASSWORD_AUTH && !user.twoFactorEnabled
