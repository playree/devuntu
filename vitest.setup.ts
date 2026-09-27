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
 */
vi.mock('@/lib/prisma', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/prisma')>()),
  prisma: (await import('./tests/helpers/prisma')).stubPrismaClient(),
}))
