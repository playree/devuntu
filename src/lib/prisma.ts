import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { envu } from './env-util'

const adapter = new PrismaPg({
  connectionString: envu.server.DATABASE_URL,
})
export const prisma = new PrismaClient({ adapter })
