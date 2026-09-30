'use client'

import { AssignmentMembers } from '@/components/assignment/assignment-members'
import { GroupAssignForm } from '@/components/assignment/group-assign-form'
import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon,
  GithubIcon,
  GitlabIcon,
  InformationCircleIcon,
  SlackIcon,
  TagIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { notify } from '@/components/notify'
import { TagEditor } from '@/components/ticket/tag-editor'
import { useBoardName } from '@/components/ticket/ticket-options'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { BoardAiContext } from './board-ai-context'
import { BoardAutoRevise } from './board-auto-revise'
import { BoardGithub } from './board-github'
import { BoardGitlab } from './board-gitlab'
import { BoardProfile } from './board-profile'
import { BoardTicketTemplates } from './board-ticket-templates'
import { BoardChannelNotify } from './channel-notify'
import { DangerZone } from './danger-zone'
import {
  addBoardMember,
  createBoardTag,
  deleteBoardTag,
  getBoardAssignments,
  getBoardDetail,
  getBoardMembers,
  getBoardTags,
  removeBoardMember,
  setBoardGroups,
  updateBoardMemberRole,
  updateBoardTag,
} from './server'

/** デンジャーゾーンは誤操作を避けるため初期状態で閉じておく */
const defaultExpandedKeys = new Set(['board_profile'])

export const BoardSettingsClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()

  const { data: board, reload, refresh, isLoading } = useActionData(() => getBoardDetail({ id: boardId }))
  const { data: tags, reload: reloadTags } = useActionData(() => getBoardTags({ id: boardId }))
  // アサイン編集は manage 権限が要るため、取得できない場合は undefined のまま(フォームを出さない)
  const { data: assignments, reload: reloadAssignments } = useActionData(() => getBoardAssignments({ id: boardId }))
  // ボードグループの保存と合わせてリロードできるよう、ここで生成して AssignmentMembers に渡す
  const memberList = usePagingList({
    load: () => parseAction(getBoardMembers({ id: boardId }), { handled: 'all' }),
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  if (isLoading) {
    return <PanelSkeleton />
  }

  // useActionData は ClientError を通知しないため、取得できなかったことをここで表示する
  if (!board) {
    return <NoAccessView icon={<Cog6ToothIcon />} title={t('board_settings')} backHref='/boards' />
  }

  const isPrivate = board.kind === 'private'
  const canManageBoard = !isPrivate && board.canManage

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={boardName(board)}>
        <MultiButton
          isIconOnly
          tooltip={t('back')}
          icon={<ArrowLeftCircleIcon />}
          onPress={() => router.push('/boards')}
        />
        <MultiButton
          isIconOnly
          tooltip={t('kanban')}
          icon={<ViewColumnsIcon />}
          onPress={() => router.push(`/boards/${board.id}`)}
        >
          <ButtonGroup.Separator />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('ticket')}
          icon={<ArrowTopRightOnSquareIcon />}
          onPress={() => router.push(`/tickets?boardId=${board.id}`)}
        >
          <ButtonGroup.Separator />
        </MultiButton>
      </ContentHeader>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection
          /**
           * ボード情報: 名前 / 説明の編集とメタ情報(種別・オーナー・チケット件数など)。
           * 閲覧は誰でも可、編集可否は BoardProfile 内で manage 権限から判定する
           */
          id='board_profile'
          icon={<InformationCircleIcon />}
          title={t('board_profile')}
        >
          <BoardProfile
            /**
             * アーカイブをデンジャーゾーンから切り替えても useForm の defaultValues は追従しないので、
             * 古い archived で上書きしないよう再マウントさせる
             */
            key={`${board.id}-${board.archived}`}
            board={board}
            reload={reload}
          />
        </AccordionSection>

        {!isPrivate && (
          <AccordionSection
            /**
             * ボードメンバー: 直接メンバーとグループ経由メンバーの一覧 / 追加 / ロール変更 / 削除。
             * プライベートボードは所有者 1 人固定でメンバーの概念が無いのでセクションごと出さない
             */
            id='board_members'
            icon={<UsersIcon />}
            title={t('board_members')}
          >
            <AssignmentMembers
              aria-label='board member list'
              hasRole
              reloadAssignments={reloadAssignments}
              pagingList={memberList}
              manage={
                // manage 権限が無いメンバーには一覧だけ見せる
                canManageBoard && assignments
                  ? {
                      addLabel: t('add_member'),
                      userOptions: assignments.userOptions,
                      assignedUserIds: [...assignments.ownerIds, ...assignments.memberIds],
                      add: (req) => addBoardMember({ id: board.id, ...req }),
                      updateRole: (req) => updateBoardMemberRole({ id: board.id, ...req }),
                      remove: (userId) => removeBoardMember({ id: board.id, userId }),
                      roleNote: t('msg_owner_required'),
                    }
                  : undefined
              }
            />
          </AccordionSection>
        )}

        {!isPrivate && board.isAdmin && assignments && (
          <AccordionSection
            /**
             * ボードグループ: グループ単位のアサイン。グループ構成の変更は管理者だけに許すので
             * isAdmin かつアサイン情報(選択肢)を取得できたときだけ表示する
             */
            id='board_groups'
            icon={<UserGroupIcon />}
            title={t('board_groups')}
          >
            <GroupAssignForm
              key={assignments.groupIds.join(',')}
              label={t('board_groups')}
              groupOptions={assignments.groupOptions}
              groupIds={assignments.groupIds}
              notice={
                <NoticePanel className='text-xs' status='warning'>
                  {t('msg_group_assign_admin_only')}
                </NoticePanel>
              }
              onSave={(groupIds) => setBoardGroups({ id: board.id, groupIds })}
              reload={() => {
                reloadAssignments()
                memberList.reload()
              }}
            />
          </AccordionSection>
        )}

        <AccordionSection
          /**
           * タグ管理: ボード内タグの追加 / 編集 / 削除。member もチケット編集中に新しいタグが要るため
           * 追加は閲覧権限だけでも許可し、canManage は編集 / 削除の可否として渡す
           */
          id='tag_manage'
          icon={<TagIcon />}
          title={t('tag_manage')}
        >
          <TagEditor
            tags={tags ?? []}
            canManage={board.canManage}
            onCreate={async (req) => {
              await parseAction(createBoardTag({ boardId: board.id, ...req }))
              notify.success(t('msg_added_target', { target: req.name }))
              reloadTags()
            }}
            onUpdate={async (req) => {
              await parseAction(updateBoardTag(req))
              notify.success(t('msg_updated_target', { target: req.name }))
              reloadTags()
            }}
            onDelete={async (tag) => {
              await parseAction(deleteBoardTag({ id: tag.id }))
              reloadTags()
            }}
          />
        </AccordionSection>

        <AccordionSection
          /**
           * チケットテンプレート: 作成画面で選ぶと本文・受け入れ条件・タグ・優先度を埋める雛形。
           * AI 向けコンテキストと同じく、閲覧はメンバー、編集は owner と管理者(プライベートボードは所有者)
           */
          id='ticket_templates'
          icon={<DocumentDuplicateIcon />}
          title={t('ticket_templates')}
        >
          <BoardTicketTemplates boardId={board.id} tags={tags ?? []} canManage={board.canManage} />
        </AccordionSection>

        <AccordionSection
          /**
           * AI 向けコンテキスト: MCP でチケットと一緒に返すボード共通の前提。
           * MCP で届く内容なのでメンバーには閲覧させ、編集は owner と管理者に限る。
           * 保存後は開いているセクションを閉じないよう、isLoading を立てない refresh で取り直す
           */
          id='board_ai_context'
          icon={<CpuChipIcon />}
          title={t('board_ai_context')}
        >
          <BoardAiContext boardId={board.id} aiContext={board.aiContext} canManage={board.canManage} reload={refresh} />
        </AccordionSection>

        {canManageBoard && board.slackEnabled && (
          <AccordionSection
            /**
             * チャネル通知: このボードの出来事を投稿するチャンネルとイベント。設定できるのはボードの
             * オーナー(と管理者)だけで、Slack 連携が使えない環境ではセクションごと出さない
             */
            id='board_slack'
            icon={<SlackIcon />}
            title={t('board_slack_notify')}
          >
            <BoardChannelNotify boardId={board.id} />
          </AccordionSection>
        )}

        {board.canManage && (
          <AccordionSection
            /**
             * GitHub 連携: 対応付けるリポジトリとマージで完了の設定。設定できるのは owner と管理者
             */
            id='board_github'
            icon={<GithubIcon />}
            title={t('board_github')}
          >
            <BoardGithub boardId={board.id} />
          </AccordionSection>
        )}

        {board.canManage && board.gitlabVisible && (
          <AccordionSection
            /**
             * GitLab 連携: 対応付けるプロジェクトとマージで完了の設定。設定できるのは owner と管理者。
             * GITLAB_URLS が未設定の環境では、対応付けが残っている(外すため)ときだけ出す
             */
            id='board_gitlab'
            icon={<GitlabIcon />}
            title={t('board_gitlab')}
          >
            <BoardGitlab boardId={board.id} />
          </AccordionSection>
        )}

        {board.canManage && (
          <AccordionSection
            /**
             * エージェントの自動差し戻し: 紐付いた PR / MR の CI 失敗・レビュー指摘で、報告済みのエージェント担当チケットを
             * revise へ戻す。GitHub / GitLab の Webhook で受けるので、Git 連携と同じく owner と管理者が設定する
             */
            id='board_agent_auto_revise'
            icon={<ArrowPathIcon />}
            title={t('board_agent_auto_revise')}
          >
            <BoardAutoRevise boardId={board.id} />
          </AccordionSection>
        )}

        {canManageBoard && (
          <AccordionSection
            /**
             * デンジャーゾーン: アーカイブ切替とボード削除。プライベートボードは削除させないので
             * manage 権限に加えてチームボードであることを条件にする
             */
            id='danger_zone'
            icon={<ExclamationTriangleIcon className='text-danger' />}
            title={t('danger_zone')}
          >
            <DangerZone board={board} reload={reload} />
          </AccordionSection>
        )}
      </Accordion>
    </FlexCol>
  )
}
