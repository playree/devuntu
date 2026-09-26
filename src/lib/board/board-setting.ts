/**
 * ボード設定(概要 / アーカイブ / チャネル通知 / 削除)の処理(サーバー専用)
 *
 * `/boards/[id]/settings` の Server Action から呼ぶ。権限の検証もここで行うので、
 * 呼び出し側は入力の検証と結果の返却だけを持つ。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { errInvalidOperation, errValidation } from '../error'
import { logger } from '../logger'
import { getBoardNotifySetting, setBoardNotifySetting } from '../notify/notify-board-setting'
import { prisma, type Db } from '../prisma'
import { getSlackSettings, hasSlackCredentials } from '../slack/slack-account'
import { listSlackChannels } from '../slack/slack-server'
import { detachBoardAttachments, listBoardAttachmentKeys, removeAttachmentByKey } from '../storage/attachment'
import { countTicketsByBoard } from './board'
import { assertBoardAccess, assertTeamBoard, isAdminActor, type Actor } from './board-access'
import { reserveBoardKey, rethrowDuplicatedBoardKey } from './board-key'
import { isGithubEnabled } from './board-repository'
import { TICKET_STATUSES } from './ticket-enum'

/**
 * ボード詳細(概要 + 権限)
 *
 * 権限は画面側のセクション表示に使う。クライアントの非表示だけに頼らず各 Action でも検証する。
 */
export const getBoardDetail = async (actor: Actor, id: string) => {
  const access = await assertBoardAccess(actor, id, 'view')

  const board = await prisma.board.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      key: true,
      name: true,
      description: true,
      archived: true,
      createdAt: true,
    },
  })
  if (!board) {
    throw errInvalidOperation()
  }

  const counts = await countTicketsByBoard([id])
  const byStatus = counts[id] ?? {}

  return {
    ...board,
    description: board.description ?? '',
    role: access.role,
    via: access.via,
    // 権限境界: ユーザー単位のアサインは owner、グループ単位は管理者のみ
    canManage: access.role === 'owner' || isAdminActor(actor),
    isAdmin: isAdminActor(actor),
    // チャネル通知セクションの表示可否。連携が使えない環境では設定させても届かない
    slackEnabled: hasSlackCredentials() && (await getSlackSettings()).enabled,
    // GitHub 連携セクションの表示可否。署名シークレットが無ければ Webhook を受けられない
    githubEnabled: isGithubEnabled(),
    ticketCounts: Object.fromEntries(TICKET_STATUSES.map((status) => [status, byStatus[status] ?? 0])),
  }
}

/** ボードの名称 / キー / 説明の更新(owner または管理者)。プライベートボードは変更できない */
export const updateBoardProfile = async (
  actor: Actor,
  { id, name, key, description }: { id: string; name: string; key: string; description?: string },
) => {
  const board = await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, id, 'manage', tx)
    await assertTeamBoard(tx, id)

    // キーを変えると既存チケットの表示IDも一斉に変わる(番号は据え置き)。
    // 共有済みの旧表示IDは解決できなくなるため、変更できるのは owner と管理者に限っている
    const current = await tx.board.findUnique({ where: { id }, select: { key: true } })
    if (current && current.key !== key) {
      // 手放した旧キーは履歴に残り続けるので、他のボードが拾って旧表示IDを横取りすることはない。
      // 自分が以前使っていたキーへ戻すのは許される(reserveBoardKey に boardId を渡している)
      await reserveBoardKey(tx, key, id)
    }

    return tx.board
      .update({ where: { id }, data: { name, key, description }, select: { id: true, name: true } })
      .catch(rethrowDuplicatedBoardKey)
  })

  logger.info({ userId: actor.id, id }, 'board updated')
  return board
}

/**
 * アーカイブの切り替え(owner または管理者)。
 *
 * 更新するのは archived だけにしてある。プロフィール編集と同じ経路にすると、
 * デンジャーゾーンが画面に表示中の name / key を送り返し、他者が変更した直後の値を巻き戻してしまう。
 */
export const setBoardArchivedState = async (actor: Actor, id: string, archived: boolean) => {
  await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, id, 'manage', tx)
    await assertTeamBoard(tx, id)
    await tx.board.update({ where: { id }, data: { archived }, select: { id: true } })
  })

  logger.info({ userId: actor.id, id, archived }, 'board archived updated')
}

/**
 * チャネル通知の設定を触ってよいか(owner または管理者 / チームボードのみ)。
 *
 * Slack のチャンネル一覧はプライベートチャンネル名を含むので、Slack を叩く前にこれで権限を確定させる。
 * 全ユーザーが自分のプライベートボードの owner なので、manage 権限だけでは絞れない。
 */
export const assertBoardNotifyManageable = async (actor: Actor, id: string, tx: Db) => {
  await assertBoardAccess(actor, id, 'manage', tx)
  await assertTeamBoard(tx, id)
}

/** ボードのチャネル通知の現在値(owner または管理者) */
export const getBoardNotify = async (actor: Actor, id: string) => {
  await assertBoardNotifyManageable(actor, id, prisma)
  return getBoardNotifySetting(id)
}

/**
 * ボードのチャネル通知の設定(owner または管理者)。
 *
 * 通知先が空文字、またはイベントが 1 つも選ばれていなければ「通知しない」。
 * 存在しない / Bot が参加していないチャンネルを保存すると設定できたように見えて通知だけ
 * 届かなくなるため、一覧と突き合わせてから保存する(一覧はキャッシュ済みなので追加のコストはほぼ無い)。
 *
 * 突き合わせの成否はチャンネルの実在を教えてしまうので、権限の確定を先に済ませる。
 * トランザクション内の再検証は、確定から更新までの間に権限が変わる場合のために残す。
 */
export const setBoardNotify = async (
  actor: Actor,
  { id, slackChannelId, events }: { id: string; slackChannelId: string; events: readonly NotifyEvent[] },
) => {
  const channelId = slackChannelId || null

  await assertBoardNotifyManageable(actor, id, prisma)

  if (channelId) {
    const channels = await listSlackChannels()
    if (!channels?.some((channel) => channel.id === channelId)) {
      throw errValidation('slackChannelId')
    }
  }

  await prisma.$transaction(async (tx) => {
    await assertBoardNotifyManageable(actor, id, tx)
    await setBoardNotifySetting(id, { slackChannelId: channelId, events }, tx)
  })
}

/**
 * ボード削除(owner または管理者)。チケット / タグ / アサインは Cascade で消える。
 *
 * 添付のレコードは Cascade に任せず、削除の前にボードとの紐付けだけを外して残す。
 * レコードごと消してしまうと、コミット後の実体削除が失敗した分を誰も辿れなくなり、
 * DBを起点にした掃除の対象から永久に外れる。行が残っていれば、本文が消えて参照が
 * 外れた添付として `maintenance-attachment.ts` が拾い直し、実体ごと回収して収束する。
 *
 * 回収されるまでの間 `boardId` は null(全ログインユーザーへ配信してよい扱い)になるが、
 * キーは推測できず、URLを知っているのは削除したボードのメンバーだけなので実害は無い。
 */
export const deleteBoard = async (actor: Actor, id: string) => {
  const keys = await prisma.$transaction(async (tx) => {
    await assertBoardAccess(actor, id, 'manage', tx)
    await assertTeamBoard(tx, id)
    // 紐付けを外すとボードから辿れなくなるので、キーはここで控える
    const keys = await listBoardAttachmentKeys(tx, id)
    await detachBoardAttachments(tx, id)
    await tx.board.delete({ where: { id } })
    return keys
  })

  // ロールバックで実データを失わないよう、コミットしてから実体を消す
  let removed = 0
  for (const key of keys) {
    if (await removeAttachmentByKey(key)) {
      removed += 1
    }
  }

  logger.info({ userId: actor.id, id, attachments: keys.length, removed }, 'board deleted')
}
