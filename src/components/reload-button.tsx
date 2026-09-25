'use client'

import { MultiButton } from '@/components/general/button'
import { ArrowPathIcon } from '@/components/icon'
import { useLocale } from '@/locale/client'
import { ButtonGroup } from '@heroui/react'
import { FC } from 'react'

/**
 * ContentHeader に置くリロードボタン。
 * ButtonGroup の区切り線はボタンの中に置く規約なので、前にボタンが無いときは hasSeparator={false} にする。
 *
 * ButtonGroup は直下の子へグループの一員であることを示す prop を注入するので、残りの props は
 * そのまま MultiButton へ渡す(落とすとグループの variant が効かなくなる)。
 */
export const ReloadButton: FC<{ onReload: () => void; hasSeparator?: boolean } & Record<string, unknown>> = ({
  onReload,
  hasSeparator = true,
  ...props
}) => {
  const { t } = useLocale()
  return (
    <MultiButton {...props} isIconOnly tooltip={t('reload')} icon={<ArrowPathIcon />} onPress={() => onReload()}>
      {hasSeparator && <ButtonGroup.Separator />}
    </MultiButton>
  )
}
