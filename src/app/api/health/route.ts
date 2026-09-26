import { nowDate } from '@/lib/day'
import { NextResponse } from 'next/server'

export const GET = async () => {
  return NextResponse.json({ status: 'ok', timestamp: nowDate().toISOString() }, { status: 200 })
}
