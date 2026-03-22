'use client'

import { Button, ButtonProps, Dropdown, Label, Skeleton } from '@heroui/react'
import { useTheme } from 'next-themes'
import { FC, ReactNode, SVGProps, useEffect, useMemo, useState } from 'react'
import { twMerge } from 'tailwind-merge'

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
  const [mounted, setMounted] = useState(false)
  const iconSize = iconSizes[size]
  const { theme, setTheme, systemTheme } = useTheme()
  const [selectedKeys, setSelectedKeys] = useState(new Set([theme || 'system']))

  const lightIcon = useMemo(() => <SunIcon width={iconSize} />, [iconSize])
  const darkIcon = useMemo(() => <MoonIcon width={iconSize} />, [iconSize])
  const [systemIcon, setSystemIcon] = useState<ReactNode>()
  const [selectIcon, setSelectIcon] = useState<ReactNode>()
  const [selectedValue, setSelectedValue] = useState('Loading')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setSystemIcon(systemTheme === 'dark' ? darkIcon : lightIcon)
  }, [darkIcon, lightIcon, systemTheme])

  useEffect(() => {
    console.debug('theme:', theme)
    switch (theme) {
      case 'system':
        setSelectIcon(systemIcon)
        break
      case 'light':
        setSelectIcon(lightIcon)
        break
      case 'dark':
        setSelectIcon(darkIcon)
        break
    }
  }, [darkIcon, lightIcon, systemIcon, theme])

  useEffect(() => {
    setSelectedValue(Array.from(selectedKeys).join(', ').replaceAll('_', ' '))
  }, [selectedKeys])

  if (!mounted) {
    return <Skeleton className={twMerge('h-8 w-20 rounded-lg', className)} />
  }

  return (
    <Dropdown className={className}>
      <Button aria-label='Select Theme' size={size} variant={variant} className={twMerge('min-w-20', className)}>
        {selectIcon}
        {selectedValue === 'system' ? 'auto' : selectedValue}
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          disallowEmptySelection
          selectionMode='single'
          selectedKeys={selectedKeys}
          onAction={(key) => {
            const keyString = key.toString()
            setSelectedKeys(new Set([keyString]))
            setTheme(keyString)
          }}
        >
          <Dropdown.Item key='system' id='system' textValue='auto'>
            <Dropdown.ItemIndicator />
            {systemIcon}
            <Label>auto</Label>
          </Dropdown.Item>
          <Dropdown.Item key='light' id='light' textValue='light'>
            <Dropdown.ItemIndicator />
            {lightIcon}
            <Label>light</Label>
          </Dropdown.Item>
          <Dropdown.Item key='dark' id='dark' textValue='dark'>
            <Dropdown.ItemIndicator />
            {darkIcon}
            <Label>dark</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}
