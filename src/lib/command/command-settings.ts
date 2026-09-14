/**
 * コマンドごとのメタ情報の読み書き(サーバー専用)
 *
 * 定義そのものは YAML が持ち、ここが持つのは「画面から実行してよいか」「誰に許すか」「並び順」だけ。
 * 認可判定そのものは `command-access.ts` に置き、ここは DB の出し入れに徹する
 * (`agent-runner-config.ts` が設定の読み書きだけを持ち、認可を持ち込まないのと同じ切り分け)。
 */

import { prisma } from '../prisma'

export type CommandSettingRecord = {
  commandKey: string
  enabled: boolean
  sortOrder: number
  allowedGroupIds: string[]
}

/** 未登録のコマンドの既定。定義を置いただけでは動かない */
export const defaultCommandSetting = (commandKey: string): CommandSettingRecord => ({
  commandKey,
  enabled: false,
  sortOrder: 0,
  allowedGroupIds: [],
})

/** 指定したコマンドキーの設定をまとめて引く。未登録のキーは既定値で埋める */
export const getCommandSettings = async (commandKeys: string[]): Promise<Map<string, CommandSettingRecord>> => {
  const settings = new Map(commandKeys.map((key) => [key, defaultCommandSetting(key)]))
  if (commandKeys.length === 0) {
    return settings
  }

  const rows = await prisma.commandSetting.findMany({
    where: { commandKey: { in: commandKeys } },
    select: {
      commandKey: true,
      enabled: true,
      sortOrder: true,
      allowedGroups: { select: { groupId: true } },
    },
  })
  rows.forEach((row) => {
    settings.set(row.commandKey, {
      commandKey: row.commandKey,
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      allowedGroupIds: row.allowedGroups.map((allowed) => allowed.groupId),
    })
  })
  return settings
}

/** 1件だけ引く。未登録なら既定値 */
export const getCommandSetting = async (commandKey: string): Promise<CommandSettingRecord> =>
  (await getCommandSettings([commandKey])).get(commandKey) ?? defaultCommandSetting(commandKey)

/**
 * 設定を保存する。行が無ければ作る。
 *
 * 許可グループは差分ではなく総入れ替えにする。画面から渡ってくるのは選択後の集合なので、
 * 差分計算を挟むと「消したはずのグループが残る」経路を作り込みやすい。
 * 有効化と許可グループがずれた状態を残さないよう、1トランザクションで入れ替える。
 */
export const setCommandSetting = async (input: {
  commandKey: string
  enabled: boolean
  sortOrder: number
  allowedGroupIds: string[]
}): Promise<void> => {
  const { commandKey, enabled, sortOrder } = input
  // 同じグループが二重に渡ってきても一意制約で落とさない
  const allowedGroupIds = [...new Set(input.allowedGroupIds)]

  await prisma.$transaction(async (tx) => {
    const setting = await tx.commandSetting.upsert({
      where: { commandKey },
      update: { enabled, sortOrder },
      create: { commandKey, enabled, sortOrder },
      select: { id: true },
    })
    await tx.commandAllowedGroup.deleteMany({
      where: { settingId: setting.id, groupId: { notIn: allowedGroupIds.length > 0 ? allowedGroupIds : [''] } },
    })
    if (allowedGroupIds.length > 0) {
      await tx.commandAllowedGroup.createMany({
        data: allowedGroupIds.map((groupId) => ({ settingId: setting.id, groupId })),
        skipDuplicates: true,
      })
    }
  })
}
