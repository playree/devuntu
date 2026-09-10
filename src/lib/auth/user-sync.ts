import { prisma } from '../prisma'
import { saveImageAttachmentFromUrl } from '../storage/attachment'
import { isUploadUrl } from '../storage/upload'

/** DBへ反映するプロフィール値。`undefined` のフィールドは更新されない */
type SyncedProfile = {
  name?: string
  image?: string
}

/** 同期の判断に必要な既存ユーザーの値 */
type SyncTarget = { id: string; name: string; image: string | null }

/**
 * IdPのアバターをDevuntu側へコピーする。
 *
 * `User.image` に入れてよいのは Devuntu が管理する `/api/upload/<key>` だけで、IdPのURLはそのまま保存しない。
 * 既に管理下の画像を持っているユーザー(本人がアップロードした、または過去にコピー済み)は対象外。
 * 外部URLが残っている既存ユーザーは、ここを通ったタイミングでコピーに置き換わる。
 *
 * コピーできなかった場合は `undefined` を返して既存値を維持する。**`null` を返してはいけない**
 * (better-auth はそのまま `image = NULL` として書き込み、既存のアバターを消してしまう)。
 */
const resolveAvatar = async (user: SyncTarget | null, image: string | null | undefined) => {
  if (!user || !image || isUploadUrl(user.image ?? '')) {
    return undefined
  }
  return saveImageAttachmentFromUrl(image, user.id)
}

/**
 * OIDC/ソーシャルログイン時にDBへ反映するプロフィール値を決める。
 *
 * 対象ユーザーが存在しない場合(新規サインアップ)は名前だけそのまま通す。
 * サインアップは databaseHooks で拒否されるが、いずれにせよ外部URLを持ち込ませない。
 */
export const resolveSyncedProfile = async (
  email: string | null | undefined,
  profile: { name?: string; image?: string | null },
): Promise<SyncedProfile> => {
  if (!email) {
    return { name: profile.name, image: undefined }
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, image: true, nameLocked: true },
  })
  return {
    /**
     * 表示名を本人が設定済みなら現在値をそのまま返す。
     * `undefined` にしても更新から外れてはくれない。better-auth はプロバイダから受け取った
     * プロフィールを `name || ''` に正規化してから更新へ渡すため、空文字で潰れてしまう。
     */
    name: user?.nameLocked ? user.name : profile.name,
    image: await resolveAvatar(user, profile.image),
  }
}
