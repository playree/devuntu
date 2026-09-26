import { nowDate } from '@/lib/day'

export const GET = async () => {
  return Response.json({ status: 'ok', timestamp: nowDate().toISOString() })
}
