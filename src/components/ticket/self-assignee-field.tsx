'use client'

import { useLocale } from '@/locale/client'
import { Description, Input, Label, TextField } from '@heroui/react'
import { FC } from 'react'

/**
 * プライベートチケットの担当者欄。
 *
 * プライベートチケット(boardId なし)は所有者本人しか担当者になり得ないため、
 * 選択させず読み取り専用で名前を表示する。実際の保存値はサーバー側
 * (`resolveTicketAssignee`)で確定するので、この欄はフォームの値を持たない。
 */
export const SelfAssigneeField: FC<{ userName: string }> = ({ userName }) => {
  const { t } = useLocale()

  return (
    <TextField isReadOnly>
      <Label>{t('assignee')}</Label>
      {/* readOnly は TextField から context 経由で input へ伝わる */}
      <Input value={userName} variant='secondary' />
      <Description>{t('msg_auto_assign_self')}</Description>
    </TextField>
  )
}
