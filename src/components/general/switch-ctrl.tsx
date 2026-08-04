'use client'

import { Switch, SwitchProps } from '@heroui/react'
import { FC } from 'react'

export const SwitchItem: FC<SwitchProps & { id: string; label: string }> = ({ id, label, ...props }) => {
  return (
    <Switch {...props} id={id}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  )
}
