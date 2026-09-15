/**
 * コマンド実行の認可判定(サーバー専用)
 *
 * `src/proxy.ts` の matcher は Server Action(next-action ヘッダ)と `/api/**` を除外しているため、
 * パス単位の制御ではこの機能を守れない。実行にも一覧にも SSE にも、必ずここを通す。
 *
 * 判定は `assertBoardAccess`(`src/lib/board/board.ts`)と同じ形にしてある。
 */

import { type Actor, isAdminActor } from '../board/board'
import { envu } from '../env-util'
import { errInvalidOperation } from '../error'
import { prisma } from '../prisma'
import { type CommandDef } from './command'
import { findCommandDef, listCommandDefs } from './command-catalog'
import { type CommandSettingRecord, defaultCommandSetting, getCommandSettings } from './command-settings'

export type CommandNeed = 'view' | 'execute'

/** ユーザーが所属するグループIDの集合 */
const membershipGroupIds = async (userId: string): Promise<Set<string>> => {
  const memberships = await prisma.userGroup.findMany({ where: { userId }, select: { groupId: true } })
  return new Set(memberships.map((membership) => membership.groupId))
}

/**
 * 1件ぶんの判定。
 *
 * **許可グループが空 = 管理者のみ**。連携設定(`integration-settings.ts`)の
 * 「空 = 全ユーザー許可」とは意図的に逆にしてある。コマンド実行を誤って全員へ開くと
 * 取り返しがつかないので、指定漏れを緩い側へ倒さない。
 */
const canUse = (setting: CommandSettingRecord, actor: Actor, groupIds: Set<string>): boolean => {
  if (isAdminActor(actor)) {
    return true
  }
  if (!setting.enabled) {
    return false
  }
  return setting.allowedGroupIds.some((groupId) => groupIds.has(groupId))
}

/**
 * 一覧に使う並び順。
 *
 * 未登録のうちは定義ファイルの `sortOrder` を使い、画面から保存された値があればそちらを優先する。
 * 管理画面と利用者向け画面で並びが食い違わないよう、判定はこの関数だけに置く。
 *
 * 値の真偽では判断しない。`0` は先頭へ寄せる正当な指定なので、
 * 保存された `0` を未登録の既定と同じ扱いにすると定義ファイル側の値へ戻ってしまう。
 */
export const effectiveSortOrder = (setting: CommandSettingRecord, def: CommandDef): number =>
  setting.registered ? setting.sortOrder : def.sortOrder

/**
 * 利用者が扱えるコマンドの一覧。
 *
 * `need` で絞り込みを変える。管理者は設定するために無効なコマンドも見る必要があるので `view` では出すが、
 * 実行できるものだけを出したい画面(`/commands`)は `execute` を渡す。
 * 一覧に出るのに実行すると弾かれる、という食い違いを作らないため。
 */
export const listAvailableCommands = async (
  actor: Actor,
  need: CommandNeed = 'view',
): Promise<{ def: CommandDef; setting: CommandSettingRecord }[]> => {
  const defs = listCommandDefs()
  if (defs.length === 0) {
    return []
  }

  const [settings, groupIds] = await Promise.all([
    getCommandSettings(defs.map((def) => def.id)),
    isAdminActor(actor) ? new Set<string>() : membershipGroupIds(actor.id),
  ])

  return (
    defs
      // getCommandSettings は要求したキーを必ず既定値で埋めて返すので、ここで欠けることはない
      .map((def) => ({ def, setting: settings.get(def.id) ?? defaultCommandSetting(def.id) }))
      .filter(({ setting }) => canUse(setting, actor, groupIds) && (need !== 'execute' || setting.enabled))
      .sort(
        (a, b) =>
          effectiveSortOrder(a.setting, a.def) - effectiveSortOrder(b.setting, b.def) ||
          a.def.label.localeCompare(b.def.label),
      )
  )
}

/**
 * 指定コマンドを扱えることを確かめる。扱えなければ throw する。
 *
 * 存在しないコマンドと権限が無いコマンドを同じ `errInvalidOperation` にしているのは、
 * どのコマンドが定義されているかを、実行できない相手に教えないため。
 */
export const assertCommandAccess = async (
  actor: Actor,
  commandKey: string,
  need: CommandNeed,
): Promise<{ def: CommandDef; setting: CommandSettingRecord }> => {
  // 機能自体が無効なら、定義があっても管理者であっても扱えない
  if (!envu.server.COMMAND_EXEC_ENABLED) {
    throw errInvalidOperation()
  }

  const def = findCommandDef(commandKey)
  if (!def) {
    throw errInvalidOperation()
  }

  const [settings, groupIds] = await Promise.all([
    getCommandSettings([commandKey]),
    isAdminActor(actor) ? new Set<string>() : membershipGroupIds(actor.id),
  ])
  const setting = settings.get(commandKey)
  if (!setting || !canUse(setting, actor, groupIds)) {
    throw errInvalidOperation()
  }

  // 実行は「有効化されていること」を管理者にも要求する。無効のまま動かせると設定の意味が無くなる
  if (need === 'execute' && !setting.enabled) {
    throw errInvalidOperation()
  }

  return { def, setting }
}

/** メニューの出し分け用。1つでも扱えるコマンドがあるか */
export const canUseAnyCommand = async (actor: Actor): Promise<boolean> =>
  envu.server.COMMAND_EXEC_ENABLED && (await listAvailableCommands(actor)).length > 0
