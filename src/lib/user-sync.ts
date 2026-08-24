import { prisma } from './prisma'

/**
 * OIDC/ソーシャルログイン時にDBへ反映するプロフィール値を決める。
 *
 * ロックフラグが立っているフィールドは `undefined` を返し、better-auth に上書きさせない
 * (better-auth はログイン取得値を既存値とスプレッドで合成してPrismaのupdateへ渡すが、
 * Prismaは `undefined` を渡したフィールドを更新対象から除外するため)。
 * 対象ユーザーが存在しない場合(新規サインアップ)はそのまま同期する。
 */
export const resolveSyncedProfile = async <T extends { name?: string; image?: string | null }>(
  email: string | null | undefined,
  profile: T,
): Promise<T> => {
  if (!email) {
    return profile
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { nameLocked: true, avatarLocked: true },
  })
  return {
    ...profile,
    ...(user?.nameLocked && { name: undefined }),
    ...(user?.avatarLocked && { image: undefined }),
  }
}
