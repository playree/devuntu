'use client'

import { FlexCol } from '@/components/general/flex'
import { SingleSelectField } from '@/components/general/select'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { COMMON_TIMEZONES, tzOffsetLabel, tzOffsetMinutes } from '@/lib/day'
import { useLocale } from '@/locale/client'
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
  const timezoneOptions = useMemo(() => {
    const base = COMMON_TIMEZONES.includes(value) ? COMMON_TIMEZONES : [value, ...COMMON_TIMEZONES]
    return Object.fromEntries(
      [...base].sort((a, b) => tzOffsetMinutes(a) - tzOffsetMinutes(b)).map((tz) => [tz, tzOffsetLabel(tz)]),
    )
  }, [value])

  return (
    <FlexCol>
      <div className='max-w-sm px-1'>
        <SingleSelectField // 見出しは AccordionSection 側で出しているのでラベルは読み上げ用にだけ残す
          label={t('timezone')}
          isLabelHidden
          groupOptions={timezoneOptions}
          value={value}
          onChange={async (key) => {
            if (!key) {
              return
            }
            const prev = selected
            setSelected(key)
            try {
              await parseAction(setUserTimezone({ timezone: key }))
              notify.success(t('msg_saved'))
            } catch (e) {
              setSelected(prev)
              throw e
            }
          }}
        />
      </div>
    </FlexCol>
  )
}
