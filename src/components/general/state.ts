import { useOverlayState } from '@heroui/react'
import { nanoid } from 'nanoid'
import { useState } from 'react'

export const useModalState = () => {
  const id = nanoid()
  const [key, setKey] = useState({ id, key: id })
  const state = useOverlayState({ onOpenChange: (isOpen) => setKey(({ id }) => ({ id, key: `${id}_${isOpen}` })) })
  return { ...state, key: key.key }
}
