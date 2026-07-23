import { el } from '@/locale'
import { z } from 'zod'

const reHalfString = /^[a-zA-Z0-9!-/:-@¥[-`{-~ ]*$/

export const zName = z.string().min(2, el('@invalid_name')).max(30, el('@invalid_name'))
export const zEmail = z.email(el('@invalid_email'))
export const zPassword = z
  .string()
  .min(8, el('@invalid_password'))
  .max(20, el('@invalid_password'))
  .regex(reHalfString, el('@invalid_password'))
export const zDescription = z.string().max(40, el('@invalid_description')).optional()

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const zImageFile = z
  .instanceof(File, { message: el('@required_field') })
  .refine((file) => file.size <= MAX_IMAGE_SIZE, el('@invalid_image_size'))
  .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), el('@invalid_image_type'))

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
  name: zName,
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
  name: zName,
  email: zEmail,
  password: zPassword.optional(),
  isAdmin: z.boolean(),
  groups: z.array(z.uuidv7()).default([]),
})
export type CreateUser = z.infer<typeof scCreateUser>
export type CreateUserIn = z.input<typeof scCreateUser>
export type CreateUserOut = z.output<typeof scCreateUser>

export const scUpdateUser = z.object({
  id: z.uuidv7(),
  name: zName,
  email: zEmail,
  isAdmin: z.boolean(),
  groups: z.array(z.uuidv7()),
})
export type UpdateUser = z.infer<typeof scUpdateUser>

export const scUpdatePasskey = z.object({
  id: z.uuidv7(),
  name: z.string(),
})
export type UpdatePasskey = z.infer<typeof scUpdatePasskey>

export const scDashboardLayout = z.object({
  left: z.array(z.string().nullable()),
  right: z.array(z.string().nullable()),
})
export type DashboardLayout = z.infer<typeof scDashboardLayout>

export const scUpdateDashboard = z.object({
  layout: scDashboardLayout,
})

export const scUpdateAnnouncement = z.object({
  body: z.string(),
})
export type UpdateAnnouncement = z.infer<typeof scUpdateAnnouncement>

export const scCreateLinkWidget = z.object({
  name: zName,
  url: z.url(),
  description: zDescription,
  icon: zImageFile.optional(),
})
export type CreateLinkWidget = z.infer<typeof scCreateLinkWidget>

export const scUpdateLinkWidget = z.object({
  id: z.uuidv7(),
  name: zName,
  url: z.url(),
  description: zDescription,
  icon: zImageFile.nullish(), // File | null | undefined
})
export type UpdateLinkWidget = z.infer<typeof scUpdateLinkWidget>

export const scCreateGroup = z.object({
  name: zName,
  description: zDescription.optional(),
})
export type CreateGroup = z.infer<typeof scCreateGroup>

export const scUpdateGroup = z.object({
  id: z.uuidv7(),
  name: zName,
  description: zDescription.optional(),
})
export type UpdateGroup = z.infer<typeof scUpdateGroup>

export const zShareTitle = z.string().trim().max(50) // 空文字許可(表示側でフォールバック)

/** CalendarShare.options の構造 */
export const scCalendarShareOptions = z.object({ title: z.string().max(50).optional() })
export type CalendarShareOptions = z.infer<typeof scCalendarShareOptions>

export const scUpdateCalendarShareTitle = z.object({ title: zShareTitle })
export type UpdateCalendarShareTitle = z.infer<typeof scUpdateCalendarShareTitle>

/** 追加Busy時間(件名+曜日+時間帯)。時間は 0:00 からの分(30分刻み)で扱う */
const zMin30 = z.number().int().multipleOf(30, el('@invalid_time_range'))
// InputCtrl の constraintSchema(z.ZodObject 前提)へ渡すため refine 前の base を分離
export const scBusyTimeBase = z.object({
  title: z.string().trim().min(1, el('@required_field')).max(50),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, el('@select_weekday')),
  startMin: zMin30.min(0, el('@invalid_time_range')).max(1410, el('@invalid_time_range')),
  endMin: zMin30.min(30, el('@invalid_time_range')).max(1440, el('@invalid_time_range')),
})
export const scBusyTimeFields = scBusyTimeBase.refine((d) => d.startMin < d.endMin, {
  path: ['endMin'],
  message: el('@invalid_time_range'),
})

export const scCreateBusyTime = scBusyTimeFields
export type CreateBusyTime = z.infer<typeof scCreateBusyTime>

export const scUpdateBusyTime = z.object({ id: z.uuidv7() }).and(scBusyTimeFields)
export type UpdateBusyTime = z.infer<typeof scUpdateBusyTime>

/** Google アカウント連携設定 */
export const scUpdateGoogleAccountSettings = z.object({
  enabled: z.boolean(),
  allowedGroupIds: z.array(z.uuidv7()),
})
export type UpdateGoogleAccountSettings = z.infer<typeof scUpdateGoogleAccountSettings>
