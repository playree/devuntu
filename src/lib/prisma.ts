import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { envu } from './env-util'

const adapter = new PrismaPg({
  connectionString: envu.server.DATABASE_URL,
})
export const prisma = new PrismaClient({ adapter })

/** 一意制約違反(P2002)。重複をクライアント向けのエラーへ変換する箇所で使う */
export const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
