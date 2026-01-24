'use client'

import { Button, ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, SwitchProps } from '@heroui/react'
import { useTheme } from 'next-themes'
import { FC, ReactNode, SVGProps, useEffect, useMemo, useState } from 'react'

const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
} as const

const SunFilledIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <g fill='currentColor'>
      <path d='M19 12a7 7 0 11-7-7 7 7 0 017 7z' />
      <path d='M12 22.96a.969.969 0 01-1-.96v-.08a1 1 0 012 0 1.038 1.038 0 01-1 1.04zm7.14-2.82a1.024 1.024 0 01-.71-.29l-.13-.13a1 1 0 011.41-1.41l.13.13a1 1 0 010 1.41.984.984 0 01-.7.29zm-14.28 0a1.024 1.024 0 01-.71-.29 1 1 0 010-1.41l.13-.13a1 1 0 011.41 1.41l-.13.13a1 1 0 01-.7.29zM22 13h-.08a1 1 0 010-2 1.038 1.038 0 011.04 1 .969.969 0 01-.96 1zM2.08 13H2a1 1 0 010-2 1.038 1.038 0 011.04 1 .969.969 0 01-.96 1zm16.93-7.01a1.024 1.024 0 01-.71-.29 1 1 0 010-1.41l.13-.13a1 1 0 011.41 1.41l-.13.13a.984.984 0 01-.7.29zm-14.02 0a1.024 1.024 0 01-.71-.29l-.13-.14a1 1 0 011.41-1.41l.13.13a1 1 0 010 1.41.97.97 0 01-.7.3zM12 3.04a.969.969 0 01-1-.96V2a1 1 0 012 0 1.038 1.038 0 01-1 1.04z' />
    </g>
  </svg>
)

const MoonFilledIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
  <svg
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    width={width}
    strokeWidth={strokeWidth}
    {...props}
  >
    <path
      d='M21.53 15.93c-.16-.27-.61-.69-1.73-.49a8.46 8.46 0 01-1.88.13 8.409 8.409 0 01-5.91-2.82 8.068 8.068 0 01-1.44-8.66c.44-1.01.13-1.54-.09-1.76s-.77-.55-1.83-.11a10.318 10.318 0 00-6.32 10.21 10.475 10.475 0 007.04 8.99 10 10 0 002.89.55c.16.01.32.02.48.02a10.5 10.5 0 008.47-4.27c.67-.93.49-1.519.32-1.79z'
      fill='currentColor'
    />
  </svg>
)

export interface ThemeSwitchProps {
  className?: string
  classNames?: SwitchProps['classNames']
}

export const ThemeSwitchList: FC<{
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: ButtonProps['variant']
}> = ({ className, size = 'md', variant = 'faded' }) => {
  const iconSize = iconSizes[size]
  const { theme, setTheme, systemTheme } = useTheme()
  const [selectedKeys, setSelectedKeys] = useState(new Set([theme || 'system']))

  const lightIcon = useMemo(() => <SunFilledIcon width={iconSize} />, [iconSize])
  const darkIcon = useMemo(() => <MoonFilledIcon width={iconSize} />, [iconSize])
  const [systemIcon, setSystemIcon] = useState<ReactNode>()
  const [selectIcon, setSelectIcon] = useState<ReactNode>()
  const [selectedValue, setSelectedValue] = useState('Loading')

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

  return (
    <Dropdown className={className} size={size}>
      <DropdownTrigger>
        <Button size={size} variant={variant} startContent={selectIcon} className={className}>
          {selectedValue === 'system' ? 'auto' : selectedValue}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label='Select Theme'
        variant='flat'
        disallowEmptySelection
        selectionMode='single'
        selectedKeys={selectedKeys}
        onAction={(key) => {
          const keyString = key.toString()
          setSelectedKeys(new Set([keyString]))
          setTheme(keyString)
        }}
      >
        <DropdownItem key='system' startContent={systemIcon}>
          auto
        </DropdownItem>
        <DropdownItem key='light' startContent={lightIcon}>
          light
        </DropdownItem>
        <DropdownItem key='dark' startContent={darkIcon}>
          dark
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  )
}
