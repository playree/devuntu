'use client'
import { Accordion, AccordionItem, AccordionItemProps, Button } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { FC, ReactNode } from 'react'

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

export const Menu: FC<{ closeMenu?: () => void }> = ({ closeMenu }) => {
  return (
    <div>
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
