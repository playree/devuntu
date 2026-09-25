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
      <Chip.Label className={isIconOnly ? 'sr-only' : undefined}>{uiText.on}</Chip.Label>
    </Chip>
  ) : (
    <Chip color='default' variant={variant} className='opacity-30'>
      <XCircleIcon />
      <Chip.Label className={isIconOnly ? 'sr-only' : undefined}>{uiText.off}</Chip.Label>
    </Chip>
  )
}
