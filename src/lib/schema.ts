import { el } from '@/locale'
import { z } from 'zod'

const reHalfString = /^[a-zA-Z0-9!-/:-@¥[-`{-~ ]*$/

export const zUsername = z.string().min(2, el('@invalid_username')).max(20, el('@invalid_username'))
export const zEmail = z.email(el('@invalid_email'))
export const zPassword = z
  .string()
  .min(8, el('@invalid_password'))
  .max(20, el('@invalid_password'))
  .regex(reHalfString, el('@invalid_password'))

export const scSignInUsername = z.object({
  username: zEmail,
})
export type SignInUsername = z.infer<typeof scSignInUsername>

export const scSignInPassword = z.object({
  password: z.string(),
})
export type SignInPassword = z.infer<typeof scSignInPassword>

export const scSignInOTP = z.object({
  otp: z.string(),
})
export type SignInOTP = z.infer<typeof scSignInOTP>

export const scCreateAdmin = z.object({
  name: zUsername,
  email: zEmail,
  password: zPassword,
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>

export const scTwoFaCode = z.object({
  otp: z.string(),
})
export type TwoFaCode = z.infer<typeof scTwoFaCode>
