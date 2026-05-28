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

export const scUUID = z.object({
  id: z.uuidv7(),
})

export const scSignInUsername = z.object({
  username: zEmail,
})
export type SignInUsername = z.infer<typeof scSignInUsername>

export const scSignInPassword = z.object({
  password: z.string(),
})
export type SignInPassword = z.infer<typeof scSignInPassword>

export const scOtp = z.object({
  otp: z.string(),
})
export type Otp = z.infer<typeof scOtp>

export const scTwoFaCode = z.object({
  otp: z.string(),
  trustDevice: z.boolean(),
})
export type TwoFaCode = z.infer<typeof scTwoFaCode>

export const scCreateAdmin = z.object({
  name: zUsername,
  email: zEmail,
  password: zPassword.optional(),
})
export type CreateAdmin = z.infer<typeof scCreateAdmin>

export const scInputEmail = z.object({
  email: zEmail,
})
export type InputEmail = z.infer<typeof scInputEmail>

export const scSetPassword = z.object({
  password: zPassword,
})
export type SetPassword = z.infer<typeof scSetPassword>

export const scAddOidcClient = z.object({
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
  requirePkce: z.boolean(),
})
export type AddOidcClient = z.infer<typeof scAddOidcClient>

export const scUpdateOidcClient = z.object({
  clientId: z.string(),
  clientName: z.string(),
  redirectUri: z.url(),
  skipConsent: z.boolean(),
})
export type UpdateOidcClient = z.infer<typeof scUpdateOidcClient>

export const scDeleteOidcClient = z.object({
  clientId: z.string(),
})

export const scCreateUser = z.object({
  name: zUsername,
  email: zEmail,
  password: zPassword.optional(),
  isAdmin: z.boolean(),
})
export type CreateUser = z.infer<typeof scCreateUser>

export const scUpdateUser = z.object({
  id: z.uuidv7(),
  name: zUsername,
  email: zEmail,
  isAdmin: z.boolean(),
})
export type UpdateUser = z.infer<typeof scUpdateUser>

export const scUpdatePasskey = z.object({
  id: z.uuidv7(),
  name: z.string(),
})
export type UpdatePasskey = z.infer<typeof scUpdatePasskey>
