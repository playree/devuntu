'use client'

import { type AssignRoles } from '@/components/assignment/assign-member-modal'
import { AssignmentMembers } from '@/components/assignment/assignment-members'
import { AssignmentTargets } from '@/components/assignment/assignment-targets'
import { AccordionSection } from '@/components/general/accordion'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { usePagingList } from '@/components/general/paging'
import { ContentHeader } from '@/components/header'
import {
  ArchiveBoxIcon,
  ArrowLeftCircleIcon,
  Cog6ToothIcon,
  InformationCircleIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { NoAccessView } from '@/components/no-access-view'
import { useWikiAssignRoleOptions, useWikiRoleOptions, WikiRoleChip } from '@/components/wiki-chip'
import type { WikiAssignRole, WikiSpaceRole } from '@/generated/prisma/enums'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import { Accordion } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'
import { useWikiSpace } from '../space-context'
import {
  getWikiSpaceAssignments,
  getWikiSpaceAssignOptions,
  removeWikiSpaceBoard,
  removeWikiSpaceGroup,
  removeWikiSpaceMember,
  upsertWikiSpaceBoard,
  upsertWikiSpaceGroup,
  upsertWikiSpaceMember,
} from './server'
import { WikiSpaceArchive, WikiSpaceProfile } from './space-profile'

const defaultExpandedKeys = new Set(['wiki_space_profile', 'wiki_space_members'])

/** スペースの設定(owner または管理者) */
export const WikiSpaceSettingsClient: FC = () => {
  const { t } = useLocale()
  const router = useRouter()
  const { space, access, reloadSpace } = useWikiSpace()
  const memberRoles: AssignRoles<WikiSpaceRole> = {
    options: useWikiRoleOptions(),
    Chip: WikiRoleChip,
    defaultRole: 'editor',
  }
  const targetRoles: AssignRoles<WikiAssignRole> = {
    options: useWikiAssignRoleOptions(),
    Chip: WikiRoleChip,
    defaultRole: 'viewer',
  }
  const canManage = access.canManage

  const { data: assignments, refresh: refreshAssignments } = useActionData(
    () => getWikiSpaceAssignments({ id: space.id }),
    { skip: !canManage, key: space.id },
  )
  const { data: options } = useActionData(() => getWikiSpaceAssignOptions({ id: space.id }), {
    skip: !canManage,
    key: space.id,
  })
  const memberList = usePagingList({
    load: async () => {
      if (!canManage) {
        return []
      }
      const { members } = await parseAction(getWikiSpaceAssignments({ id: space.id }), { handled: 'all' })
      return members.map((member) => ({ ...member, via: 'direct' }))
    },
    sort: { init: { column: 'name', direction: 'ascending' } },
  })

  if (!canManage) {
    return <NoAccessView icon={<Cog6ToothIcon />} title={t('wiki_space_settings')} backHref={`/wiki/${space.key}`} />
  }

  // 割り当てが変わると自分の権限(owner を外した等)も変わりうるので、スペースも取り直す
  const reloadAll = () => {
    refreshAssignments()
    memberList.reload()
    reloadSpace()
  }
  // メンバー一覧(memberList)は AssignmentMembers が自分で取り直すので含めない
  const reloadMemberAssignments = () => {
    refreshAssignments()
    reloadSpace()
  }

  return (
    <FlexCol>
      <ContentHeader icon={<Cog6ToothIcon />} title={<span className='truncate'>{space.name}</span>}>
        <MultiButton
          isIconOnly
          tooltip={t('back')}
          icon={<ArrowLeftCircleIcon />}
          onPress={() => router.push(`/wiki/${space.key}`)}
        />
      </ContentHeader>

      <Accordion allowsMultipleExpanded defaultExpandedKeys={defaultExpandedKeys}>
        <AccordionSection id='wiki_space_profile' icon={<InformationCircleIcon />} title={t('wiki_space_profile')}>
          <WikiSpaceProfile key={space.updatedAt.toISOString()} space={space} reload={reloadSpace} />
        </AccordionSection>

        <AccordionSection id='wiki_space_members' icon={<UsersIcon />} title={t('wiki_space_members')}>
          {assignments && options && (
            <AssignmentMembers // 一覧の行は操作の有無を後から変えても描き直されないので、候補と割り当てが揃ってから出す
              aria-label='wiki space member list'
              hasRole
              roles={memberRoles}
              reloadAssignments={reloadMemberAssignments}
              pagingList={memberList}
              manage={{
                addLabel: t('add_member'),
                userOptions: options.userOptions,
                assignedUserIds: assignments.members.map((member) => member.id),
                add: (req) => upsertWikiSpaceMember({ id: space.id, ...req }),
                updateRole: (req) => upsertWikiSpaceMember({ id: space.id, ...req }),
                remove: (userId) => removeWikiSpaceMember({ id: space.id, userId }),
                roleNote: t('msg_wiki_role_note'),
              }}
            />
          )}
        </AccordionSection>

        <AccordionSection id='wiki_space_groups' icon={<UserGroupIcon />} title={t('wiki_space_groups')}>
          {assignments && options && (
            <AssignmentTargets
              aria-label='wiki space group list'
              label={t('group')}
              addLabel={t('wiki_add_group')}
              items={assignments.groups}
              options={options.groupOptions}
              roles={targetRoles}
              emptyContent={t('msg_no_wiki_groups')}
              add={(req) => upsertWikiSpaceGroup({ id: space.id, ...req })}
              updateRole={(req) => upsertWikiSpaceGroup({ id: space.id, ...req })}
              remove={(targetId) => removeWikiSpaceGroup({ id: space.id, targetId })}
              reload={reloadAll}
            />
          )}
        </AccordionSection>

        <AccordionSection id='wiki_space_boards' icon={<ViewColumnsIcon />} title={t('wiki_space_boards')}>
          {assignments && options && (
            <FlexCol>
              <p className='text-muted text-xs'>{t('msg_wiki_board_assign')}</p>
              <AssignmentTargets
                aria-label='wiki space board list'
                label={t('board')}
                addLabel={t('wiki_add_board')}
                items={assignments.boards.map((board) => ({ ...board, name: `${board.name} (${board.key})` }))}
                options={options.boardOptions}
                roles={targetRoles}
                emptyContent={t('msg_no_wiki_boards')}
                add={(req) => upsertWikiSpaceBoard({ id: space.id, ...req })}
                updateRole={(req) => upsertWikiSpaceBoard({ id: space.id, ...req })}
                remove={(targetId) => removeWikiSpaceBoard({ id: space.id, targetId })}
                reload={reloadAll}
              />
            </FlexCol>
          )}
        </AccordionSection>

        <AccordionSection id='wiki_space_archive' icon={<ArchiveBoxIcon />} title={t('archived')}>
          <WikiSpaceArchive space={space} reload={reloadSpace} />
        </AccordionSection>
      </Accordion>
    </FlexCol>
  )
}
