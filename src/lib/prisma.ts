import { PrismaClient } from '@/generated/prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { envServer } from './env-server'

const adapter = new PrismaBetterSqlite3({
  url: envServer.DATABASE_URL,
})
export const prisma = new PrismaClient({ adapter })
