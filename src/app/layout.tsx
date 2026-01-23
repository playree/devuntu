import type { Metadata } from 'next'
import { Noto_Sans_JP, Roboto_Mono } from 'next/font/google'
import { twMerge } from 'tailwind-merge'
import './globals.css'
import { Providers } from './providers'

const NotoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans-jp',
})

const RobotoMono = Roboto_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-roboto-mono',
})

export const metadata: Metadata = {
  title: {
    default: 'Devuntu',
    template: `%s - Devuntu`,
  },
  description: 'Devuntu',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='ja' className={`${NotoSansJp.variable} ${RobotoMono.variable}`} suppressHydrationWarning>
      <head />
      <body className={twMerge('bg-background font-noto min-h-screen antialiased')}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
