import { vi } from 'vitest'

// ローカルの .env(開発DBを指す)を拾わせないため、無条件に代入して CI と同じ値で走らせる。
// スキーマ検証に無関係なダミー値でよい。
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test'
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'test-secret-for-schema-check-only'

/**
 * `@/lib/auth` を import すると betterAuth() が oauth-provider の init を走らせ、
 * resources のシードで oauthResource を引くため DB 接続が発生する。
 * ユニットテストに DB は無いので Prisma クライアントだけスタブにする。
 *
 * findFirst が行を返せばシードは「既に存在」と判断し(既定の insertOnly)書き込みも走らない。
 */
vi.mock('@/lib/prisma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prisma')>()),
  prisma: new Proxy(
    {},
    {
      get: () => ({
        findFirst: async () => ({}),
        findUnique: async () => ({}),
        create: async ({ data }: { data: unknown }) => data,
        update: async ({ data }: { data: unknown }) => data,
      }),
    },
  ),
}))
