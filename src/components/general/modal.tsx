import { Checkbox, Modal, ModalContainerProps, useOverlayState, UseOverlayStateReturn } from '@heroui/react'
import { nanoid } from 'nanoid'
import { usePathname } from 'next/navigation'
import {
  BaseSyntheticEvent,
  createContext,
  FC,
  forwardRef,
  ReactNode,
  SVGProps,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { MultiButton } from './button'
import { FlexCol } from './flex'

const CheckIcon: FC<SVGProps<SVGSVGElement>> = ({ width = 20, strokeWidth = 2, ...props }) => (
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
      clipRule='evenodd'
      fillRule='evenodd'
      d='M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z'
    />
  </svg>
)

export const useModalState = <T = string,>() => {
  const id = nanoid()
  const [key, setKey] = useState({ id, key: id })
  const state = useOverlayState({ onOpenChange: (isOpen) => setKey(({ id }) => ({ id, key: `${id}_${isOpen}` })) })
  const [targetObj, setTargetObj] = useState<T>()

  return {
    ...state,
    key: key.key,
    open: (target?: T) => {
      if (target) {
        setTargetObj(target)
      }
      state.open()
    },
    close: () => {
      setTargetObj(undefined)
      state.close()
    },
    target: targetObj,
  }
}

export type ModalBaseProps = { state: UseOverlayStateReturn; reload: () => void }

// HeroUIのModalはlg(32rem)の次がfull/coverしかないため、その間のサイズを補完する
// Tailwindのスキャン対象になるようクラス名は完全なリテラルで記述すること
const EXTRA_MODAL_SIZES = {
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
} as const

type ExtraModalSize = keyof typeof EXTRA_MODAL_SIZES
export type FormModalSize = NonNullable<ModalContainerProps['size']> | ExtraModalSize

const isExtraModalSize = (size: FormModalSize): size is ExtraModalSize => size in EXTRA_MODAL_SIZES

export const FormModal: FC<{
  children: ReactNode
  state: UseOverlayStateReturn
  onSubmit: (e?: BaseSyntheticEvent) => Promise<void>
  title: { text: string; icon?: ReactNode }
  footer: ReactNode
  hiddenCloseButton?: boolean
  size?: FormModalSize
}> = ({ children, state, onSubmit, title, footer, hiddenCloseButton, size }) => {
  // 拡張サイズの場合はHeroUIのsizeを使わず、Modal.Dialogにmax-w-*を当てて上書きする
  const extraSizeClass = size && isExtraModalSize(size) ? EXTRA_MODAL_SIZES[size] : undefined

  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable={false}>
      <Modal.Container placement='top' size={extraSizeClass ? undefined : (size as ModalContainerProps['size'])}>
        <Modal.Dialog className={extraSizeClass}>
          <form
            /**
             * Modal.Dialog(flex flex-col / max-h-full)と Modal.Body(min-h-0 flex-1 + overflow-y-auto)の間に
             * 素のformが入るとBodyのflex-1が解決されず、背の高い内容がoverflow-clipで切れてしまう。
             * form自体を縮むflexコンテナにしてHeroUIのscroll='inside'を機能させる
             */
            onSubmit={onSubmit}
            className='flex min-h-0 flex-col'
          >
            {!hiddenCloseButton && <Modal.CloseTrigger />}
            <Modal.Header>
              <Modal.Heading className='flex items-center gap-2'>
                {title.icon}
                {title.text}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className='pt-2'>{children}</Modal.Body>
            <Modal.Footer>{footer}</Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

type ConfirmParam = { title: string; text: string; requireCheck?: boolean; autoClose?: boolean; onlyOk?: boolean }
type ConfirmModalParam = { uiText?: { ok?: string; cancel?: string; confirmed?: string } }
export type ConfirmModalRef = {
  confirm: (param: ConfirmParam) => Promise<boolean>
  close: () => void
}
export const ConfirmModal = forwardRef<ConfirmModalRef, ConfirmModalParam>(({ uiText }, ref) => {
  const [confirmParam, setConfirmParam] = useState<ConfirmParam>()
  const state = useOverlayState()
  const response = useRef<(value: boolean | PromiseLike<boolean>) => void>(undefined)
  const [isAgree, setAgree] = useState(false)
  const [isPending, setPending] = useState(false)
  const pathname = usePathname()
  const [prevPathname, setPrevPathname] = useState(pathname)

  // レンダリング中にパスの変更をチェック
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setConfirmParam(undefined)
  }

  useImperativeHandle(ref, () => ({
    confirm: (param) => {
      if (state.isOpen) {
        // 利用中
        throw new Error('ConfirmModal is currently in use.')
      }

      setPending(false)
      setAgree(!param.requireCheck)
      setConfirmParam(param)
      state.open()
      return new Promise((resolve) => {
        response.current = resolve
      })
    },
    close: state.close,
  }))

  return (
    <Modal.Backdrop variant='blur' isOpen={state.isOpen} onOpenChange={state.setOpen} isDismissable={false}>
      <Modal.Container placement='top'>
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>{confirmParam?.title || ''}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <FlexCol>
              <div className='text-foreground wrap-anywhere whitespace-pre-wrap'>{confirmParam?.text || ''}</div>
              {confirmParam?.requireCheck && (
                <Checkbox
                  id='confirm-agree'
                  onChange={setAgree}
                  isSelected={isAgree}
                  variant='secondary'
                  isDisabled={isPending}
                >
                  <Checkbox.Content>
                    <Checkbox.Control className='size-5'>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    {uiText?.confirmed || 'Confirmed'}
                  </Checkbox.Content>
                </Checkbox>
              )}
            </FlexCol>
          </Modal.Body>
          <Modal.Footer>
            {!confirmParam?.onlyOk && (
              <MultiButton
                variant='ghost'
                isDisabled={isPending}
                onPress={() => {
                  if (response.current) {
                    response.current(false)
                    response.current = undefined
                  }
                  state.close()
                }}
              >
                {uiText?.cancel || 'Cancel'}
              </MultiButton>
            )}
            <MultiButton
              icon={<CheckIcon />}
              isDisabled={!isAgree}
              isPending={isPending}
              onPress={async () => {
                if (response.current) {
                  response.current(true)
                  response.current = undefined
                }
                if (confirmParam?.autoClose === false) {
                  setPending(true)
                } else {
                  state.close()
                }
              }}
            >
              {uiText?.ok || 'OK'}
            </MultiButton>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
})
ConfirmModal.displayName = 'ConfirmModal'

const defaultConfirmModalRef: ConfirmModalRef = {
  confirm: async () => false,
  close: () => {},
}
const ConfirmModalContext = createContext<{
  confirmModal: () => ConfirmModalRef
}>({
  confirmModal: () => defaultConfirmModalRef,
})
export const useConfirmModal = () => {
  return useContext(ConfirmModalContext)
}
export const ConfirmModalProvider: FC<{ children: ReactNode } & ConfirmModalParam> = ({ children, uiText }) => {
  const refModal = useRef<ConfirmModalRef>(defaultConfirmModalRef)
  return (
    <>
      <ConfirmModal ref={refModal} uiText={uiText} />
      <ConfirmModalContext.Provider
        value={{
          confirmModal: () => refModal.current,
        }}
      >
        {children}
      </ConfirmModalContext.Provider>
    </>
  )
}
