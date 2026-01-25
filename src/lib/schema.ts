import { z } from 'zod'

export const scCreateAdmin = z.object({
  email: z.email(),
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>
