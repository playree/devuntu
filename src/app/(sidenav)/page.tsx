import { type Metadata } from 'next'
import { FC } from 'react'
import { HomeClient } from './client'

export const metadata: Metadata = {
  title: 'Home',
}

const Home: FC = async () => {
  return <HomeClient />
}
export default Home
