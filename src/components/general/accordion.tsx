import { Accordion } from '@heroui/react'
import { ComponentProps, FC, ReactNode } from 'react'
import { tv } from 'tailwind-variants'

const bodyStyles = tv({ base: 'px-4' })

/**
 * Accordion の 1 セクション。
 * Heading / Trigger / Indicator / Panel / Body の入れ子を隠し、アイコン + 見出し + 中身だけで書けるようにする。
 * `Accordion` 本体は開閉状態の管理が呼び出し側の関心事なので、HeroUI のものをそのまま使う。
 */
export const AccordionSection: FC<
  // Disclosure の props は DOM 属性の title と render props 版の children を含むので、独自 props と衝突しないよう外す
  Omit<ComponentProps<typeof Accordion.Item>, 'children' | 'title'> & {
    /** 見出しのアイコン */
    icon?: ReactNode
    /** 見出しテキスト */
    title: ReactNode
    /** 中身の className(パディングやレイアウトの調整用) */
    bodyClassName?: string
    /**
     * 閉じている間は中身を描画しない。
     *
     * 閉じた Panel は DOM から外れず `hidden="until-found"`(= `content-visibility: hidden`)が
     * 付くだけで children は描画される。その中に Popover のトリガー(react-aria の `Pressable`)が
     * あると可視性チェックに落ち、開発時だけ誤った警告
     * (`<Pressable> child must be focusable.`)がトリガーの数だけ出る。
     *
     * 畳むと中身は破棄されるため、入力途中の内容を失わせたくないフォームには使わない。
     */
    isLazyBody?: boolean
    children?: ReactNode
  }
> = ({ icon, title, bodyClassName, isLazyBody, children, ...props }) => (
  <Accordion.Item {...props}>
    {({ isExpanded }) => (
      <>
        <Accordion.Heading>
          <Accordion.Trigger className='gap-1'>
            {icon}
            {title}
            <Accordion.Indicator />
          </Accordion.Trigger>
        </Accordion.Heading>
        <Accordion.Panel>
          <Accordion.Body className={bodyStyles({ className: bodyClassName })}>
            {isLazyBody && !isExpanded ? null : children}
          </Accordion.Body>
        </Accordion.Panel>
      </>
    )}
  </Accordion.Item>
)
