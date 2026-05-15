'use client'

import { authClient } from '@/lib/auth-client'
import type { Selection } from '@heroui/react'
import { Button, cn, Dropdown, Label, Skeleton } from '@heroui/react'
import { FC, useState } from 'react'
import { setCookie } from '../general/cookie/client'
import { useLocale } from './client'
import { setUserLocale } from './server'

export const LocaleSwitch: FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ className, size = 'md' }) => {
  const { locale, lcConfig, setLocale } = useLocale()
  const { data: session } = authClient.useSession()
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set([locale]))

  if (!locale) {
    return <Skeleton className={cn('h-8 w-18 rounded-lg', className)} />
  }

  return (
    <Dropdown className={className}>
      <Button
        aria-label='Select Lang'
        variant='outline'
        size={size}
        className={cn('min-w-20', className)}
      >{`lang: ${locale}`}</Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          disallowEmptySelection
          selectionMode='single'
          selectedKeys={selectedKeys}
          onAction={(key) => {
            const keyString = key.toString()
            const keys = new Set([keyString])
            setSelectedKeys(keys)
            setCookie(lcConfig.cookie.name, keyString, { maxAge: lcConfig.cookie.maxAge, path: '/' })
            setLocale(keyString)
            if (session?.user) {
              // DB保存
              console.debug('update user locale:', keyString)
              setUserLocale({ locale: keyString })
            }
            return
          }}
        >
          {lcConfig.locales.map((lc) => {
            return (
              <Dropdown.Item key={lc} id={lc} textValue={lc}>
                <Dropdown.ItemIndicator />
                <Label>{lc}</Label>
              </Dropdown.Item>
            )
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
