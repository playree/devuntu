'use client'
import { MultiButton } from '@/components/general/button'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import {
  ArrowLeftStartOnRectangleIcon,
  ServerStackIcon,
  Squares2X2Icon,
  UserCircleIcon,
  UsersIcon,
} from '@/components/icon'
import { LocaleSwitch } from '@/components/locale/locale-switch'
import { LogoSVG } from '@/components/logo'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { useLocale } from '@/locale/client'
import { Accordion, Avatar, Button, Card, cn } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode, useEffect } from 'react'

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
        size='sm'
        fullWidth
        className='justify-start rounded-xl px-4 hover:bg-gray-100 dark:hover:bg-neutral-900'
        variant='ghost'
        onPress={() => {
          router.push(to)
          if (closeMenu) {
            closeMenu()
          }
        }}
      >
        {icon}
        {text}
      </Button>
    </div>
  )
}

const SignOutButton: FC = () => {
  const { t } = useLocale()
  const router = useRouter()

  return (
    <MultiButton
      isSmart
      variant='outline'
      icon={<ArrowLeftStartOnRectangleIcon />}
      onPress={() => {
        authClient.signOut()
        router.push(authConfig.path.signIn)
      }}
    >
      {t('signout')}
    </MultiButton>
  )
}

const defaultExpandedKeys = new Set(['group_admin'])

export const Menu: FC<{ closeMenu?: () => void }> = ({ closeMenu }) => {
  const { data: session } = authClient.useSession()
  const { t } = useLocale()

  useEffect(() => {
    // Debug
    console.debug('@session', session)
  }, [session])

  return (
    <div>
      <div
        className={cn(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808020_1px,transparent_1px),linear-gradient(to_bottom,#80808020_1px,transparent_1px)]',
          'mask-[linear-gradient(to_right,#000_50%,transparent_100%)]',
        )}
      ></div>

      <Card>
        <Card.Content>
          <div className='flex items-center gap-2'>
            {/* <UserCircleIcon className='mr-2' /> */}
            <Avatar>
              <Avatar.Image src={session?.user.image ?? ''} />
              <Avatar.Fallback>{session?.user?.name ? session.user.name.charAt(0) : '?'}</Avatar.Fallback>
            </Avatar>
            <div>{session?.user?.name}</div>
          </div>
        </Card.Content>
      </Card>

      <div // テーマ・言語
        className='flex p-2'
      >
        <ThemeSwitchList size='sm' className='mr-2' />
        <LocaleSwitch size='sm' />
      </div>

      <div // サインアウト
        className='flex px-2'
      >
        <SignOutButton />
      </div>

      <div className='mt-4'>
        <Accordion allowsMultipleExpanded hideSeparator defaultExpandedKeys={defaultExpandedKeys}>
          <MenuButton to='/' text={t('dashboard')} icon={<Squares2X2Icon />} closeMenu={closeMenu} />
          <MenuButton to='/account' text={t('account')} icon={<UserCircleIcon />} closeMenu={closeMenu} />

          <Accordion.Item id='group_admin' hidden={session?.user.role !== 'admin'}>
            <Accordion.Heading>
              <Accordion.Trigger>
                {t('admin')}
                <Accordion.Indicator />
              </Accordion.Trigger>
            </Accordion.Heading>
            <Accordion.Panel>
              <Accordion.Body className='grid grid-cols-1 px-2'>
                <MenuButton to='/admin/users' text={t('user_manage')} icon={<UsersIcon />} closeMenu={closeMenu} />
                <MenuButton
                  to='/admin/oidc-clients'
                  text={t('oidc_clients')}
                  icon={<ServerStackIcon />}
                  closeMenu={closeMenu}
                />
              </Accordion.Body>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </div>

      <div className='absolute inset-x-4 bottom-2'>
        <LogoSVG width={80} className='mt-8' />
      </div>
    </div>
  )
}

export const createMenu = (closeMenu?: () => void) => {
  return <Menu closeMenu={closeMenu} />
}
