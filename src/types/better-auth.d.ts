import 'better-auth/plugins'

declare module 'better-auth/plugins' {
  interface UserWithTwoFactor {
    locale?: string | null
  }
}
