/**
 * 管理画面(ユーザー / グループ / 外部サービス連携)の入力スキーマ
 */

import { el } from '@/locale'
import { z } from 'zod'
import { AGENT_EMAIL_DOMAIN } from '../agent/agent'
import { zDescription, zEmail, zName, zPassword } from './schema'

/** 人間のユーザー用。エージェント専用のアドレス空間を人間側から埋められないようにする */
export const zUserEmail = zEmail.refine((email) => !email.endsWith(`@${AGENT_EMAIL_DOMAIN}`), el('@invalid_email'))

export const scCreateUser = z.object({
  name: zName,
  email: zUserEmail,
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
  email: zUserEmail,
  isAdmin: z.boolean(),
  nameLocked: z.boolean(),
  groups: z.array(z.uuidv7()),
})
export type UpdateUser = z.infer<typeof scUpdateUser>

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

/** 外部サービス連携設定(Google / Slack で共通) */
export const scUpdateIntegrationSettings = z.object({
  enabled: z.boolean(),
  allowedGroupIds: z.array(z.uuidv7()),
})
export type UpdateIntegrationSettings = z.infer<typeof scUpdateIntegrationSettings>
