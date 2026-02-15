'use client'

import { authClient } from '@/lib/auth-client'
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Skeleton } from '@heroui/react'
import { FC, useEffect, useState } from 'react'
import { twMerge } from 'tailwind-merge'
import { setCookie } from '../general/cookie/client'
import { useLocale } from './client'
import { setUserLocale } from './server'

export const LocaleSwitch: FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ className, size = 'md' }) => {
  const [mounted, setMounted] = useState(false)
  const { locale, lcConfig, setLocale } = useLocale()
  const { data: session } = authClient.useSession()
  const [selectedKeys, setSelectedKeys] = useState(new Set([locale]))
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
    <Dropdown className={className} size={size}>
      <DropdownTrigger>
        <Button size={size} variant='faded' className={className}>{`lang: ${selectedValue}`}</Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label='Select Lang'
        variant='flat'
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
          return <DropdownItem key={lc}>{lc}</DropdownItem>
        })}
      </DropdownMenu>
    </Dropdown>
  )
}
