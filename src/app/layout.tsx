import { envu } from '@/lib/env-util'
import { localeConfig } from '@/locale/config'
import { cn } from '@heroui/react'
import type { Metadata } from 'next'
import { Noto_Sans_JP, Roboto_Mono } from 'next/font/google'
import { cookies, headers } from 'next/headers'
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const acceptLanguage = (await headers()).get('accept-language')
  const defaultLocale = envu.server.DEFAULT_LOCALE || localeConfig.locales[0]
  // LocaleProvider が SSR でもクライアントと同じロケールを選べるようにサーバー側で読んで渡す
  const cookieLocale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null

  return (
    <html lang='ja' className={`${NotoSansJp.variable} ${RobotoMono.variable}`} suppressHydrationWarning>
      <head />
      <body className={cn('bg-background text-foreground font-noto min-h-screen antialiased')}>
        <Providers
          themeProps={{ attribute: 'class' }}
          defaultLocale={defaultLocale}
          acceptLanguage={acceptLanguage}
          cookieLocale={cookieLocale}
        >
          <div className='relative flex h-screen flex-col'>{children}</div>
        </Providers>
      </body>
    </html>
  )
}
