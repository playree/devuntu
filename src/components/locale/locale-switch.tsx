'use client'

import { authClient } from '@/lib/auth-client'
import type { Selection } from '@heroui/react'
import { Button, Dropdown, Label, Skeleton } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { setCookie } from '../general/cookie/client'
import { useLocale } from './client'
import { setUserLocale } from './server'

export const LocaleSwitch: FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ className, size = 'md' }) => {
  const [mounted, setMounted] = useState(false)
  const { locale, lcConfig, setLocale } = useLocale()
  const { data: session } = authClient.useSession()
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set([locale]))
  const [selectedValue, setSelectedValue] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setSelectedKeys(new Set([locale]))
  }, [locale])

  useEffect(() => {
    setSelectedValue(Array.from(selectedKeys).join(', ').replaceAll('_', ' '))
  }, [selectedKeys])

  if (!mounted) {
    return <Skeleton className={twMerge('h-8 w-18 rounded-lg', className)} />
  }

  return (
    <Dropdown className={className}>
      <Button
        aria-label='Select Lang'
        variant='outline'
        size={size}
        className={twMerge('min-w-20', className)}
      >{`lang: ${selectedValue}`}</Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          disallowEmptySelection
          selectionMode='single'
          selectedKeys={selectedKeys}
          onAction={(key) => {
            const keyString = key.toString()
            setSelectedKeys(new Set([keyString]))
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
