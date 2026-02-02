import { PrismaClient } from '@/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { envu } from './env-util'

const adapter = new PrismaBetterSqlite3({
  url: envu.server.DATABASE_URL,
})
export const prisma = new PrismaClient({ adapter })
