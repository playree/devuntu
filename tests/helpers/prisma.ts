/**
 * `@/lib/prisma` の差し替え
 *
 * vi.mock の factory は import より先に評価されるため、factory の中で動的 import して使う。
 *
 * ```ts
 * vi.mock('@/lib/prisma', async () => (await import('../../helpers/prisma')).mockPrisma({ user: ['findUnique'] }))
 * ```
 */

import { vi } from 'vitest'

type Models = Record<string, readonly string[]>

type MockPrismaOptions = {
  /**
   * `$transaction(cb)` の cb に渡す値。省略時は models で生やしたモデル自体を渡す。
   * 配列(バッチ)の呼び出しは常に `Promise.all` で解く
   */
  tx?: unknown
  /**
   * models に無いモデルを `stubModel` で受ける。
   * `@/lib/auth` の初期化(oauth-provider のシード)が引くモデルを気にせず済ませたいときに付ける
   */
  stubOthers?: boolean
  /** `prisma` / `isUniqueViolation` 以外の export を足す、または上書きする */
  exports?: Record<string, unknown>
}

/**
 * 存在確認で行を返し、書き込みは data をそのまま返すモデル。
 * oauth-provider のシードは findFirst が行を返せば「既に存在」と判断し書き込まない
 */
export const stubModel = () => ({
  findFirst: async () => ({}),
  findUnique: async () => ({}),
  create: async ({ data }: { data: unknown }) => data,
  update: async ({ data }: { data: unknown }) => data,
})

/** 何も指定しなければ全モデルが `stubModel` になる(vitest.setup.ts の既定) */
export const stubPrismaClient = () => new Proxy({}, { get: () => stubModel() })

/** models に並べたモデルのメソッドを vi.fn で生やした `@/lib/prisma` モジュール */
export const mockPrisma = (models: Models = {}, options: MockPrismaOptions = {}) => {
  const client: Record<string, unknown> = Object.fromEntries(
    Object.entries(models).map(([model, methods]) => [
      model,
      Object.fromEntries(methods.map((method) => [method, vi.fn()])),
    ]),
  )
  const tx = 'tx' in options ? options.tx : client
  client.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? await (arg as (tx: unknown) => unknown)(tx) : await Promise.all(arg as unknown[]),
  )

  const prisma = options.stubOthers
    ? new Proxy(client, { get: (target, prop: string) => (prop in target ? target[prop] : stubModel()) })
    : client

  return { isUniqueViolation, ...options.exports, prisma }
}

/** 本物と同じく Prisma の一意制約違反(P2002)だけを true にする */
const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'P2002'
