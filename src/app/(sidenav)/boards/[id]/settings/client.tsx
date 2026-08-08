'use client'

import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import {
  ArrowLeftCircleIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  Cog6ToothIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TagIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { notify } from '@/components/notify'
import { TagEditor } from '@/components/ticket/tag-editor'
import { useBoardName } from '@/components/ticket/ticket-chip'
import { parseAction, useActionData } from '@/lib/action-client'
import { useLocale } from '@/locale/client'
import { Accordion, ButtonGroup } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { BoardMembers } from './board-members'
import { BoardProfile } from './board-profile'
import { DangerZone } from './danger-zone'
import { GroupManage } from './group-manage'
import {
  createBoardTag,
  deleteBoardTag,
  getBoardAssignments,
  getBoardDetail,
  getBoardTags,
  updateBoardTag,
} from './server'

/** デンジャーゾーンは誤操作を避けるため初期状態で閉じておく */
const defaultExpandedKeys = new Set(['board_profile', 'board_members', 'board_groups', 'tag_manage'])

export const BoardSettingsClient: FC<{ boardId: string }> = ({ boardId }) => {
  const { t } = useLocale()
  const router = useRouter()
  const boardName = useBoardName()

  const { data: board, reload, isLoading } = useActionData(() => getBoardDetail({ id: boardId }))
  const { data: tags, reload: reloadTags } = useActionData(() => getBoardTags({ id: boardId }))
  // アサイン編集は manage 権限が要るため、取得できない場合は undefined のまま(フォームを出さない)
  const { data: assignments, reload: reloadAssignments } = useActionData(() => getBoardAssignments({ id: boardId }))

  if (isLoading) {
    return <PanelSkeleton />
  }

  // parseAction は ClientError を notify せず throw するため、ここで明示的に表示する
  if (!board) {
    return (
      <FlexCol>
        <ContentHeader icon={<Cog6ToothIcon />} title={t('board_settings')}>
          <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
            <ArrowLeftCircleIcon />
          </MultiButton>
        </ContentHeader>
        <NoticePanel>{t('msg_no_access')}</NoticePanel>
      </FlexCol>
    )
  }

  const isPrivate = board.kind === 'private'
  const canManageBoard = !isPrivate && board.canManage

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={boardName(board)}>
        <MultiButton isIconOnly tooltip={t('back')} onPress={() => router.push('/boards')}>
          <ArrowLeftCircleIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('kanban')} onPress={() => router.push(`/boards/${board.id}`)}>
          <ButtonGroup.Separator />
          <ViewColumnsIcon />
        </MultiButton>
        <MultiButton isIconOnly tooltip={t('ticket')} onPress={() => router.push(`/tickets?boardId=${board.id}`)}>
          <ButtonGroup.Separator />
          <ArrowTopRightOnSquareIcon />
        </MultiButton>
        <MultiButton
          isIconOnly
          tooltip={t('reload')}
          onPress={() => {
            reload()
            reloadTags()
            reloadAssignments()
          }}
        >
          <ButtonGroup.Separator />
          <ArrowPathIcon />
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
            <BoardMembers // manage 権限が無いメンバーには一覧だけ見せる(assignments を渡さないと編集 UI が出ない)
              boardId={board.id}
              assignments={canManageBoard ? assignments : undefined}
              reloadAssignments={reloadAssignments}
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
            <GroupManage
              /**
               * 再取得しても useForm の defaultValues は追従しないので、
               * アサインが変わったら作り直して古い groupIds で保存されないようにする
               */
              key={assignments.groupIds.join(',')}
              boardId={board.id}
              assignments={assignments}
              reload={reloadAssignments}
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
