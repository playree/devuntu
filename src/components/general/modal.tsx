import { Modal, useOverlayState, UseOverlayStateReturn } from '@heroui/react'
import { nanoid } from 'nanoid'
import { BaseSyntheticEvent, FC, ReactNode, useState } from 'react'

export const useModalState = () => {
  const id = nanoid()
  const [key, setKey] = useState({ id, key: id })
  const state = useOverlayState({ onOpenChange: (isOpen) => setKey(({ id }) => ({ id, key: `${id}_${isOpen}` })) })
  return { ...state, key: key.key }
}

export type ModalBaseProps = { state: UseOverlayStateReturn; reload: () => void }

export const FormModal: FC<{
  children: ReactNode
  state: UseOverlayStateReturn
  onSubmit: (e?: BaseSyntheticEvent) => Promise<void>
  title: { text: string; icon?: ReactNode }
  hooter: ReactNode
  hiddenCloseButton?: boolean
}> = ({ children, state, onSubmit, title, hooter, hiddenCloseButton }) => {
  return (
    <Modal.Backdrop isOpen={state.isOpen} onOpenChange={state.setOpen}>
      <Modal.Container>
        <Modal.Dialog>
          <form onSubmit={onSubmit}>
            {!hiddenCloseButton && <Modal.CloseTrigger />}
            <Modal.Header>
              <Modal.Heading className='flex items-center gap-2'>
                {title.icon}
                {title.text}
              </Modal.Heading>
              <Modal.Body>{children}</Modal.Body>
              <Modal.Footer>{hooter}</Modal.Footer>
            </Modal.Header>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
