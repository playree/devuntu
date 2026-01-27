import { el } from '@/locale'
import { z } from 'zod'

export const zEmail = z.email(el('@invalid_email'))

export const scCreateAdmin = z.object({
  email: zEmail,
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>
