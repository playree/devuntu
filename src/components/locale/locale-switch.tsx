'use client'

import { authClient } from '@/lib/auth/auth-client'
import { Button, cn, Dropdown, Label, Skeleton } from '@heroui/react'
import { FC } from 'react'
import { setCookie } from '../general/cookie/client'
import { useLocale } from './client'
import { setUserLocale } from './server'

export const LocaleSwitch: FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ className, size = 'md' }) => {
  const { locale, lcConfig, setLocale } = useLocale()
  const { data: session } = authClient.useSession()

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
          // 初回描画時の値に固定されないよう、state に写さず現在値から導出する
          selectedKeys={new Set([locale])}
          onAction={(key) => {
            const keyString = key.toString()
            setCookie(lcConfig.cookie.name, keyString, { maxAge: lcConfig.cookie.maxAge, path: '/' })
            setLocale(keyString)
            if (session?.user) {
              // DB保存。失敗しても表示の切り替えは済んでいるので、次回ログイン時に戻るだけ
              void setUserLocale({ locale: keyString })
            }
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
