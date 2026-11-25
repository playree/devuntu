import { FC, ReactNode } from 'react'
import { WikiSpaceShell } from './space-context'

const WikiSpaceLayout: FC<{ children: ReactNode; params: Promise<{ key: string }> }> = async ({ children, params }) => {
  const { key } = await params
  return <WikiSpaceShell spaceKey={key.toUpperCase()}>{children}</WikiSpaceShell>
}
export default WikiSpaceLayout
