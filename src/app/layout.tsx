import { envu } from '@/lib/env-util'
import { pickLocale } from '@/lib/locale-util'
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

/**
 * 静的な metadata はモジュール評価時に確定してビルド時プリレンダへ巻き込まれるため、
 * 起動時の環境変数を反映できるよう generateMetadata で組み立てる。
 */
export const generateMetadata = async (): Promise<Metadata> => ({
  title: {
    default: 'Devuntu',
    template: `%s - Devuntu`,
  },
  description: 'Devuntu',
  ...(envu.server.SEARCH_ENGINE_INDEXING ? {} : { robots: { index: false, follow: false } }),
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const acceptLanguage = (await headers()).get('accept-language')
  const defaultLocale = envu.server.DEFAULT_LOCALE || localeConfig.locales[0]
  // LocaleProvider が SSR でもクライアントと同じロケールを選べるようにサーバー側で読んで渡す
  const cookieLocale = (await cookies()).get(localeConfig.cookie.name)?.value ?? null
  // <html lang> は LocaleProvider と同じ判定を通して、文書言語と表示ロケールを食い違わせない
  const locale = pickLocale(localeConfig, defaultLocale, acceptLanguage, cookieLocale)

  return (
    <html lang={locale} className={cn(NotoSansJp.variable, RobotoMono.variable)} suppressHydrationWarning>
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
