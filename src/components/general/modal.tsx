'use client'

import { Checkbox, Modal, ModalContainerProps, useOverlayState, UseOverlayStateReturn } from '@heroui/react'
import { nanoid } from 'nanoid'
import { usePathname } from 'next/navigation'
import {
  BaseSyntheticEvent,
  createContext,
  FC,
  forwardRef,
  ReactNode,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { MultiButton } from './button'
import { FlexCol } from './flex'
import { CheckIcon } from './icons'
import { SmartProvider } from './smart'
import { useGeneralUiText } from './ui-text'

export const useModalState = <T = string,>() => {
  const id = nanoid()
  const [key, setKey] = useState({ id, key: id })
  const [targetObj, setTargetObj] = useState<T>()
  const state = useOverlayState({
    onOpenChange: (isOpen) => {
      setKey(({ id }) => ({ id, key: `${id}_${isOpen}` }))
      // CloseTrigger や Esc で閉じた場合も、次の open() に前回の target を持ち越さない
      if (!isOpen) {
        setTargetObj(undefined)
      }
    },
  })

  return {
    ...state,
    key: key.key,
    open: (target?: T) => {
      setTargetObj(target)
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
            <Modal.Body className='pt-2'>
              <SmartProvider isSmartForm>{children}</SmartProvider>
            </Modal.Body>
            <Modal.Footer>
              <SmartProvider isSmart>{footer}</SmartProvider>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

export type ConfirmParam = {
  title: string
  text: string
  requireCheck?: boolean
  autoClose?: boolean
  onlyOk?: boolean
}
export type ConfirmModalRef = {
  confirm: (param: ConfirmParam) => Promise<boolean>
  close: () => void
}
export const ConfirmModal = forwardRef<ConfirmModalRef>((_, ref) => {
  const uiText = useGeneralUiText()
  const [confirmParam, setConfirmParam] = useState<ConfirmParam>()
  const state = useOverlayState()
  const response = useRef<(value: boolean | PromiseLike<boolean>) => void>(undefined)
  const [isAgree, setAgree] = useState(false)
  const [isPending, setPending] = useState(false)
  const pathname = usePathname()
  const [prevPathname, setPrevPathname] = useState(pathname)

  // 待っている confirm() を必ず解決する。解決されないと呼び出し側の finally が永久に実行されない
  const settle = (value: boolean) => {
    if (response.current) {
      response.current(value)
      response.current = undefined
    }
  }

  // レンダリング中にパスの変更をチェック
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setConfirmParam(undefined)
    state.close()
  }

  // 画面遷移で閉じた場合も、待っている confirm() はキャンセル扱いで解決する
  useEffect(() => {
    settle(false)
  }, [pathname])

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
    close: () => {
      settle(false)
      state.close()
    },
  }))

  return (
    <Modal.Backdrop
      variant='blur'
      isOpen={state.isOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          settle(false)
        }
        state.setOpen(isOpen)
      }}
      isDismissable={false}
      isKeyboardDismissDisabled={isPending}
    >
      <Modal.Container placement='top'>
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading className='flex items-center gap-2'>{confirmParam?.title || ''}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <FlexCol>
              <div className='text-foreground wrap-anywhere whitespace-pre-wrap'>{confirmParam?.text || ''}</div>
              {confirmParam?.requireCheck && (
                <Checkbox id='confirm-agree' onChange={setAgree} isSelected={isAgree} isDisabled={isPending}>
                  <Checkbox.Content>
                    <Checkbox.Control className='size-5'>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    {uiText.confirmed}
                  </Checkbox.Content>
                </Checkbox>
              )}
            </FlexCol>
          </Modal.Body>
          <Modal.Footer>
            {!confirmParam?.onlyOk && (
              <MultiButton
                variant='ghost'
                isSmart
                isDisabled={isPending}
                onPress={() => {
                  settle(false)
                  state.close()
                }}
              >
                {uiText.cancel}
              </MultiButton>
            )}
            <MultiButton
              icon={<CheckIcon />}
              isSmart
              isDisabled={!isAgree}
              isPending={isPending}
              onPress={() => {
                settle(true)
                if (confirmParam?.autoClose === false) {
                  setPending(true)
                } else {
                  state.close()
                }
              }}
            >
              {uiText.ok}
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
export const ConfirmModalProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const refModal = useRef<ConfirmModalRef>(defaultConfirmModalRef)
  return (
    <>
      <ConfirmModal ref={refModal} />
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
