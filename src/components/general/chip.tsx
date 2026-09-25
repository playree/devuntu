import { Chip, ChipProps } from '@heroui/react'
import { FC } from 'react'
import { CheckBadgeIcon, XCircleIcon } from './icons'
import { useGeneralUiText } from './ui-text'

export const OnOffChip: FC<{ isState: boolean | undefined; variant?: ChipProps['variant']; isIconOnly?: boolean }> = ({
  isState,
  variant = 'tertiary',
  isIconOnly = false,
}) => {
  const uiText = useGeneralUiText()
  return isState ? (
    <Chip color='success' variant={variant}>
      <CheckBadgeIcon />
      {!isIconOnly && <Chip.Label>{uiText.on}</Chip.Label>}
    </Chip>
  ) : (
    <Chip color='default' variant={variant} className='opacity-30'>
      <XCircleIcon />
      {!isIconOnly && <Chip.Label>{uiText.off}</Chip.Label>}
    </Chip>
  )
}
