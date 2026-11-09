'use client'
import { AccordionSection } from '@/components/general/accordion'
import { UserAvatar } from '@/components/general/avatar'
import { MultiButton } from '@/components/general/button'
import { SideNavSlot, useSideNav } from '@/components/general/side-nav-slot'
import { TabsBox } from '@/components/general/tabs'
import { ThemeSwitchList } from '@/components/general/theme-switch'
import {
  ArrowLeftStartOnRectangleIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  GithubIcon,
  RocketLaunchIcon,
  ServerStackIcon,
  Squares2X2Icon,
  TicketIcon,
  UserCircleIcon,
  UserGroupIcon,
  UsersIcon,
  ViewColumnsIcon,
} from '@/components/icon'
import { LocaleSwitch } from '@/components/locale/locale-switch'
import { authClient } from '@/lib/auth/auth-client'
import { authConfig } from '@/lib/auth/auth-config'
import { navigateAfterAuth } from '@/lib/client-utils'
import { useLocale } from '@/locale/client'
import { Accordion, Button, Card, cn } from '@heroui/react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, FC, ReactNode, useContext, useEffect, useState } from 'react'

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

/**
 * 実行できるコマンドを1つでも持っているか(既定はfalse)。
 *
 * 許可グループのユーザーにも `/commands` を出すため、role では判定できない。
 * GoogleAvailableContext と同じ理由でレイアウトの Provider 経由で渡す。
 */
const CommandAvailableContext = createContext(false)

export const CommandAvailableProvider: FC<{ value: boolean; children: ReactNode }> = ({ value, children }) => (
  <CommandAvailableContext.Provider value={value}>{children}</CommandAvailableContext.Provider>
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
  /** 遷移と合わせて行う処理 */
  onNavigate?: () => void
}> = ({ text, to, closeMenu, icon, onNavigate }) => {
  const router = useRouter()
  return (
    <div>
      <Button
        size='sm'
        fullWidth
        className='my-0.5 justify-start rounded-xl px-4 hover:bg-mist-100 dark:hover:bg-neutral-900'
        variant='ghost'
        onPress={() => {
          router.push(to)
          onNavigate?.()
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

  return (
    <MultiButton
      isSmart
      variant='outline'
      icon={<ArrowLeftStartOnRectangleIcon />}
      onPress={async () => {
        await authClient.signOut()
        navigateAfterAuth(authConfig.path.signIn)
      }}
    >
      {t('signout')}
    </MultiButton>
  )
}

/** Accordion(react-aria)のキー */
type AccordionKey = string | number

const defaultExpandedKeys = new Set<AccordionKey>(['group_task', 'group_admin'])

const MENU_TAB = 'menu'
const CONTENT_TAB = 'content'

export const Menu: FC<{ closeMenu?: () => void }> = ({ closeMenu }) => {
  const { data: session } = authClient.useSession()
  const { t } = useLocale()
  // Google連携が利用可能なユーザーのみカレンダーを表示する
  const googleAvailable = useContext(GoogleAvailableContext)
  // アサインされたターゲットを持つユーザーのみリモート実行を表示する
  const commandAvailable = useContext(CommandAvailableContext)
  // ページがメニューへ内容を差し込んでいる間は、中段を「メニュー / 差し込み」のタブにする
  const { hasContent, contentLabel } = useSideNav()
  const [tab, setTab] = useState<string>(CONTENT_TAB)
  // 差し込みが始まったら(Wiki を開いたら)、メニューを選んだ状態でタブを出してから差し込み側へスライドさせる
  const [isEntering, setEntering] = useState(false)
  const [prevHasContent, setPrevHasContent] = useState(hasContent)
  if (prevHasContent !== hasContent) {
    // Wiki 内の遷移では選択を保つ
    setPrevHasContent(hasContent)
    if (hasContent) {
      setTab(MENU_TAB)
      setEntering(true)
    }
  }
  useEffect(() => {
    if (!isEntering) {
      return
    }
    // メニュー側を 1 度描いてから切り替えないと、スライドせずに差し込み側が出る
    const frame = requestAnimationFrame(() => {
      setTab(CONTENT_TAB)
      setEntering(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [isEntering])

  // タブの有無で Accordion が作り直されても、開閉の状態を保つ
  const [expandedKeys, setExpandedKeys] = useState<Set<AccordionKey>>(defaultExpandedKeys)

  const items = (
    <Accordion allowsMultipleExpanded hideSeparator expandedKeys={expandedKeys} onExpandedChange={setExpandedKeys}>
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
        <MenuButton // エージェント(承認)
          to='/agents'
          text={t('agent')}
          icon={<RocketLaunchIcon />}
          closeMenu={closeMenu}
        />
      </AccordionSection>

      <MenuButton // Wiki
        to='/wiki'
        text={t('wiki')}
        icon={<BookOpenIcon />}
        closeMenu={closeMenu}
        // Wiki を開いたままメニュー側を見ているときも Wiki 側へ戻す
        onNavigate={() => setTab(CONTENT_TAB)}
      />

      {commandAvailable && (
        <MenuButton // リモート実行
          to='/commands'
          text={t('command_exec')}
          icon={<CommandLineIcon />}
          closeMenu={closeMenu}
        />
      )}

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
        <MenuButton // OIDC Client管理
          to='/admin/oidc-clients'
          text={t('oidc_clients')}
          icon={<ServerStackIcon />}
          closeMenu={closeMenu}
        />
        <MenuButton // エージェント管理
          to='/admin/agents'
          text={t('agent_manage')}
          icon={<RocketLaunchIcon />}
          closeMenu={closeMenu}
        />
        <MenuButton // リモート管理
          to='/admin/commands'
          text={t('command_manage')}
          icon={<CommandLineIcon />}
          closeMenu={closeMenu}
        />
        <MenuButton // 設定
          to='/admin/settings'
          text={t('integration_settings')}
          icon={<Cog6ToothIcon />}
          closeMenu={closeMenu}
        />
      </AccordionSection>
    </Accordion>
  )

  return (
    <div // 上段(アカウント)・中段(スクロールする本体)・下段(ロゴ)の 3 段。中身が長くても上下は常に見せる
      className='flex h-full flex-col'
    >
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
            <UserAvatar name={session?.user?.name ?? ''} image={session?.user.image} />
            <div className='truncate'>{session?.user?.name}</div>
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

      <div className='relative mt-4 flex min-h-0 flex-1 flex-col'>
        {hasContent ? (
          <TabsBox
            variant='secondary'
            aria-label={t('side_nav_tabs')}
            className='flex min-h-0 flex-1 flex-col'
            panelClassName='overflow-y-auto pt-2'
            selectedKey={tab}
            onSelectionChange={setTab}
            // 差し込み側(ツリーの展開状態など)はタブを切り替えても描画したまま残る
            slide
            items={[
              { id: MENU_TAB, label: t('side_nav_menu'), content: items },
              { id: CONTENT_TAB, label: contentLabel, content: <SideNavSlot /> },
            ]}
          />
        ) : (
          <div className='min-h-0 flex-1 overflow-y-auto'>{items}</div>
        )}
      </div>

      <div className='relative mt-4 flex shrink-0 items-end gap-2 px-1'>
        <Link href='https://playree.github.io/devuntu/' target='_blank' rel='noopener noreferrer'>
          <Image
            /**
             * ロゴ。
             * サイドメニュー内で常に描画され LCP と判定されるため preload で先読みさせる
             */
            src='/logo.png'
            preload
            width={120}
            height={45}
            alt='Devuntu'
          />
        </Link>
        <Link
          href='https://github.com/playree/devuntu/'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='GitHub'
          className='text-foreground/70 hover:text-foreground'
        >
          <GithubIcon width={24} />
        </Link>
      </div>
    </div>
  )
}

export const createMenu = (closeMenu?: () => void) => {
  return <Menu closeMenu={closeMenu} />
}
