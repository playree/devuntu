import { type Metadata } from 'next'
import { FC } from 'react'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Account',
}

const Home: FC = async () => {
  return <div>Account</div>
}
export default Home
