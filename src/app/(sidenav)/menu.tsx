'use client'
import { AccordionSection } from '@/components/general/accordion'
import { UserAvatar } from '@/components/general/avatar'
import { MultiButton } from '@/components/general/button'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import {
  ArrowLeftStartOnRectangleIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
  ServerStackIcon,
  Squares2X2Icon,
  TicketIcon,
  UserCircleIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { LocaleSwitch } from '@/components/locale/locale-switch'
import { authClient } from '@/lib/auth-client'
import { authConfig } from '@/lib/auth-config'
import { useLocale } from '@/locale/client'
import { Accordion, Button, Card, cn } from '@heroui/react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createContext, FC, ReactNode, useContext } from 'react'

/**
 * Google連携が利用可能かどうか(既定はfalse)。
 *
 * `SideNavbar` の menu propは関数なので、サーバーコンポーネントから直接値を差し込むと
 * RSC境界を関数が越えてしまう。レイアウトで包むProvider経由で渡す。
 */
const GoogleAvailableContext = createContext(false)

export const GoogleAvailableProvider: FC<{ value: boolean; children: ReactNode }> = ({ value, children }) => (
  <GoogleAvailableContext.Provider value={value}>{children}</GoogleAvailableContext.Provider>
)

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
        className='my-0.5 justify-start rounded-xl px-4 hover:bg-gray-100 dark:hover:bg-neutral-900'
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

const defaultExpandedKeys = new Set(['group_task', 'group_admin'])

export const Menu: FC<{ closeMenu?: () => void }> = ({ closeMenu }) => {
  const { data: session } = authClient.useSession()
  const { t } = useLocale()
  // Google連携が利用可能なユーザーのみカレンダーを表示する
  const googleAvailable = useContext(GoogleAvailableContext)

  return (
    <div>
      <div
        className={cn(
          'absolute inset-0 bg-size-[20px_20px]',
          'bg-[linear-gradient(to_right,#80808018_1px,transparent_1px),linear-gradient(to_bottom,#80808018_1px,transparent_1px)]',
          'mask-[linear-gradient(to_right,#000_50%,transparent_100%)]',
        )}
      ></div>

      <Card>
        <Card.Content>
          <div className='flex items-center gap-2'>
            {/* <UserCircleIcon className='mr-2' /> */}
            <UserAvatar name={session?.user?.name ?? ''} image={session?.user.image} />
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
          <MenuButton // ダッシュボード
            to='/'
            text={t('dashboard')}
            icon={<Squares2X2Icon />}
            closeMenu={closeMenu}
          />
          {googleAvailable && (
            <MenuButton // カレンダー
              to='/cal'
              text={t('calendar')}
              icon={<CalendarDaysIcon />}
              closeMenu={closeMenu}
            />
          )}
          <MenuButton // アカウント
            to='/account'
            text={t('account')}
            icon={<UserCircleIcon />}
            closeMenu={closeMenu}
          />

          <AccordionSection // タスク管理メニュー
            id='group_task'
            title={t('task_management')}
            bodyClassName='grid grid-cols-1 px-2'
          >
            <MenuButton // ボード
              to='/boards'
              text={t('board')}
              icon={<ViewColumnsIcon />}
              closeMenu={closeMenu}
            />
            <MenuButton // チケット
              to='/tickets'
              text={t('ticket')}
              icon={<TicketIcon />}
              closeMenu={closeMenu}
            />
          </AccordionSection>

          <AccordionSection // 管理者メニュー
            id='group_admin'
            hidden={session?.user.role !== 'admin'}
            title={t('admin')}
            bodyClassName='grid grid-cols-1 px-2'
          >
            <MenuButton // ユーザー管理
              to='/admin/users'
              text={t('user_manage')}
              icon={<UsersIcon />}
              closeMenu={closeMenu}
            />
            <MenuButton // グループ管理
              to='/admin/groups'
              text={t('group_manage')}
              icon={<UserGroupIcon />}
              closeMenu={closeMenu}
            />
            <MenuButton // ダッシュボード管理
              to='/admin/dashboard'
              text={t('dashboard_manage')}
              icon={<Squares2X2Icon />}
              closeMenu={closeMenu}
            />
            <MenuButton // 連携設定
              to='/admin/settings'
              text={t('integration_settings')}
              icon={<Cog6ToothIcon />}
              closeMenu={closeMenu}
            />
            <MenuButton // OIDC Client管理
              to='/admin/oidc-clients'
              text={t('oidc_clients')}
              icon={<ServerStackIcon />}
              closeMenu={closeMenu}
            />
          </AccordionSection>
        </Accordion>
      </div>

      <div className='absolute inset-x-4 bottom-2'>
        <Image
          /**
           * ロゴ。
           * サイドメニュー内で常に描画され LCP と判定されるため priority で先読みさせる
           */
          src='/logo.png'
          priority
          width={120}
          height={45}
          alt='Devuntu'
          className='mt-8'
        />
      </div>
    </div>
  )
}

export const createMenu = (closeMenu?: () => void) => {
  return <Menu closeMenu={closeMenu} />
}
