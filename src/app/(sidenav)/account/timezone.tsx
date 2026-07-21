'use client'

import { FlexCol } from '@/components/general/flex'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action-client'
import { authClient } from '@/lib/auth-client'
import { COMMON_TIMEZONES, tzOffsetLabel, tzOffsetMinutes } from '@/lib/day'
import { useLocale } from '@/locale/client'
import { ListBox, Select } from '@heroui/react'
import { FC, useMemo, useState } from 'react'
import { setUserTimezone } from './server'

export const TimezoneSetting: FC = () => {
  const { t } = useLocale()
  const { data: session } = authClient.useSession()
  const [selected, setSelected] = useState<string | null>(null)

  // 現在値は session の timezone、未設定時は Asia/Tokyo。変更後は selected を優先
  const current = session?.user.timezone ?? 'Asia/Tokyo'
  const value = selected ?? current

  // 主要都市をオフセット順に表示。現在値が候補外なら先頭にマージして必ず表示できるようにする
  const timezones = useMemo(() => {
    const base = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
    return [...base].sort((a, b) => tzOffsetMinutes(a) - tzOffsetMinutes(b))
  }, [value])

  return (
    <FlexCol>
      <div className='max-w-sm px-1'>
        <Select
          selectionMode='single'
          value={value}
          onChange={async (key) => {
            if (!key) {
              return
            }
            const tz = key.toString()
            setSelected(tz)
            await parseAction(setUserTimezone({ timezone: tz }))
            notify.success(t('msg_saved'))
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox selectionMode='single'>
              {timezones.map((tz) => (
                <ListBox.Item key={tz} id={tz} textValue={tzOffsetLabel(tz)}>
                  {tzOffsetLabel(tz)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </FlexCol>
  )
}
