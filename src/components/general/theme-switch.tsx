'use client'

import { Button, ButtonProps, cn, Dropdown, Label, Skeleton } from '@heroui/react'
import { useTheme } from 'next-themes'
import { FC, useEffect, useMemo, useState } from 'react'
import { MoonIcon, SunIcon } from './icons'
import { useGeneralUiText } from './ui-text'

const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

export const ThemeSwitchList: FC<{
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: ButtonProps['variant']
}> = ({ className, size = 'md', variant = 'outline' }) => {
  const iconSize = iconSizes[size]
  const { theme, setTheme, systemTheme } = useTheme()
  const uiText = useGeneralUiText()
  const themeLabels: Record<string, string> = {
    system: uiText.themeSystem,
    light: uiText.themeLight,
    dark: uiText.themeDark,
  }

  /**
   * next-themes は保存済みのテーマをクライアントの初回描画時点で返す(SSR では返さない)ため、
   * マウントするまではサーバーと同じプレースホルダを出してハイドレーション不整合を避ける。
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const lightIcon = useMemo(() => <SunIcon width={iconSize} />, [iconSize])
  const darkIcon = useMemo(() => <MoonIcon width={iconSize} />, [iconSize])
  const systemIcon = useMemo(() => (systemTheme === 'dark' ? darkIcon : lightIcon), [darkIcon, lightIcon, systemTheme])
  const selectIcon = useMemo(() => {
    switch (theme) {
      case 'system':
        return systemIcon
      case 'light':
        return lightIcon
      case 'dark':
        return darkIcon
    }
  }, [darkIcon, lightIcon, systemIcon, theme])

  if (!mounted || !theme) {
    return <Skeleton className={cn('h-8 w-20 rounded-lg', className)} />
  }

  return (
    <Dropdown className={className}>
      <Button aria-label={uiText.themeSelect} size={size} variant={variant} className={cn('min-w-20', className)}>
        {selectIcon}
        {themeLabels[theme] ?? theme}
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          disallowEmptySelection
          selectionMode='single'
          // 初回描画時の値(未確定の undefined を含む)に固定されないよう、state に写さず現在値から導出する
          selectedKeys={new Set([theme])}
          onAction={(key) => setTheme(key.toString())}
        >
          <Dropdown.Item key='system' id='system' textValue={uiText.themeSystem}>
            <Dropdown.ItemIndicator />
            {systemIcon}
            <Label>{uiText.themeSystem}</Label>
          </Dropdown.Item>
          <Dropdown.Item key='light' id='light' textValue={uiText.themeLight}>
            <Dropdown.ItemIndicator />
            {lightIcon}
            <Label>{uiText.themeLight}</Label>
          </Dropdown.Item>
          <Dropdown.Item key='dark' id='dark' textValue={uiText.themeDark}>
            <Dropdown.ItemIndicator />
            {darkIcon}
            <Label>{uiText.themeDark}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
