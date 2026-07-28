'use client'

import { useLocale } from '@/locale/client'
import { Input, Label, TextField } from '@heroui/react'
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
    <TextField isDisabled>
      <Label className='text-xs font-light'>{t('assignee')}</Label>
      {/* readOnly は TextField から context 経由で input へ伝わる。
          py-1 は同じ枠に出し分ける SingleSelectCtrl(isSlim) と高さを揃えるため */}
      <Input value={userName} variant='secondary' className='py-1' />
    </TextField>
  )
}
