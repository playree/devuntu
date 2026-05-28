'use client'

import { Toast, ToastQueue } from '@heroui/react'
import { FC } from 'react'

const bottomEndQueue = new ToastQueue()
const topQueue = new ToastQueue()
export const NotifyProvider: FC = () => {
  return (
    <>
      <Toast.Provider placement='bottom end' queue={bottomEndQueue} />
      <Toast.Provider placement='top' queue={topQueue} />
    </>
  )
}
type NotifyOption = {
  description: string | undefined
}
export const notify = {
  text: (title: string, option?: NotifyOption) =>
    bottomEndQueue.add({
      variant: 'default',
      title,
      description: option?.description,
    }),
  success: (title: string, option?: NotifyOption) =>
    bottomEndQueue.add({
      variant: 'success',
      title,
      description: option?.description,
    }),
  info: (title: string, option?: NotifyOption) =>
    bottomEndQueue.add({
      variant: 'accent',
      title,
      description: option?.description,
    }),
  warn: (title: string, option?: NotifyOption) =>
    topQueue.add({
      variant: 'warning',
      title,
      description: option?.description,
    }),
  error: (title: string, option?: NotifyOption) =>
    topQueue.add(
      {
        variant: 'danger',
        title,
        description: option?.description,
      },
      { timeout: 8000 },
    ),
}
