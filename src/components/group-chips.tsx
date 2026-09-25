import { Chip } from '@heroui/react'
import { FC } from 'react'

/** 所属グループの一覧。一覧の列に並べる想定で、狭い幅では折り返す */
export const GroupChips: FC<{ groups: { id: string; name: string }[] }> = ({ groups }) => {
  if (groups.length === 0) {
    return <>-</>
  }
  return (
    <div className='flex flex-wrap gap-1'>
      {groups.map((group) => (
        <Chip key={group.id} variant='soft' color='accent' size='sm'>
          <Chip.Label>{group.name}</Chip.Label>
        </Chip>
      ))}
    </div>
  )
}
