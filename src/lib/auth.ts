import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { ulid } from 'ulid'
import { prisma } from './prisma'

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'sqlite',
  }),
  advanced: {
    database: {
      generateId: () => ulid(),
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
})
