'use client'

import { Button, ButtonProps, cn, Dropdown, Label, Skeleton } from '@heroui/react'
import { useTheme } from 'next-themes'
import { FC, SVGProps, useEffect, useMemo, useState } from 'react'
import { useGeneralUiText } from './ui-text'

const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

const SunIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 20 20'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path d='M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.06ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.061 1.06l1.06 1.06Z' />
  </svg>
)

const MoonIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 20 20'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      clipRule='evenodd'
      fillRule='evenodd'
      d='M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z'
    />
  </svg>
)

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
