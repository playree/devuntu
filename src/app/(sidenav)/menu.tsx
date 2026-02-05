'use client'
import { MultiButton } from '@/components/general/button'
import { LocaleSwitch } from '@/components/general/locale-switch'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import { ArrowLeftStartOnRectangleIcon, UserCircleIcon } from '@/components/icon'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { makeUrl } from '@/lib/env-util'
import { useLocale } from '@/locale/client'
import { Accordion, AccordionItem, AccordionItemProps, Button, Card, CardBody } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

const accordionStyles: AccordionItemProps['classNames'] = {
  title: '',
  titleWrapper: 'flex-none',
}

export const MenuButton: FC<{
  /** メニューテキスト */
  text: string
  /** 遷移先 */
  to: string
  /** Close */
  closeMenu?: () => void
  /** アイコン */
  icon?: ReactNode
}> = ({ text, to, closeMenu, icon }) => {
  const router = useRouter()
  return (
    <div>
      <Button
        color='default'
        variant='light'
        className='mb-2 h-8 w-full justify-start p-2'
        onPress={() => {
          router.push(to)
          if (closeMenu) {
            closeMenu()
          }
        }}
      >
        {icon}
        <span className={icon ? 'ml-1' : ''}>{text}</span>
      </Button>
    </div>
  )
}

const SignOutButton: FC = () => {
  const { t } = useLocale()
  const router = useRouter()

  return (
    <MultiButton
      color='default'
      variant='light'
      isSmart
      startContent={<ArrowLeftStartOnRectangleIcon />}
      onPress={() => {
        authClient.signOut()
        router.push(makeUrl(authConfig.path.signIn).toString())
      }}
    >
      {t('signout')}
    </MultiButton>
  )
}

export const Menu: FC<{ closeMenu?: () => void }> = ({ closeMenu }) => {
  const { data: session } = authClient.useSession()
  const { t } = useLocale()

  return (
    <div>
      <div
        className={twMerge(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808020_1px,transparent_1px),linear-gradient(to_bottom,#80808020_1px,transparent_1px)]',
          'mask-[linear-gradient(to_right,#000_50%,transparent_100%)]',
        )}
      ></div>

      <Card>
        <CardBody>
          <div className='flex items-center'>
            <UserCircleIcon className='mr-2' />
            <div>{session?.user?.name}</div>
          </div>
        </CardBody>
      </Card>

      <div // テーマ・言語
        className='flex p-2'
      >
        <ThemeSwitchList size='sm' className='mr-2' />
        <LocaleSwitch size='sm' />
      </div>

      <div // サインアウト
      >
        <SignOutButton />
      </div>

      <div className='mt-2'>
        <Accordion selectionMode='multiple' itemClasses={accordionStyles} defaultSelectedKeys='all' showDivider={false}>
          <AccordionItem isCompact={true} title={'Group'} classNames={{ trigger: 'cursor-pointer' }}>
            <div className='mx-2'>
              <MenuButton to='/' text={'Item1'} closeMenu={closeMenu} />
            </div>
            <div className='mx-2'>
              <MenuButton to='/account' text={'Item2'} closeMenu={closeMenu} />
            </div>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}

export const createMenu = (closeMenu?: () => void) => {
  return <Menu closeMenu={closeMenu} />
}
