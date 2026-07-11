import { z } from 'zod'

export type FieldConstraints = {
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
}

// optional/nullable/nullish などのラッパーを剥がして中身のスキーマを取り出す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const unwrap = (schema: any): any => {
  let s = schema
  while (s?._zod?.def?.innerType) {
    s = s._zod.def.innerType
  }
  return s
}

// Zod v4 のスキーマ内部（_zod.def.checks）から min/max 制約を取り出す。
// 文字列は minLength/maxLength、数値は min/max に振り分ける。
export const getFieldConstraints = (schema: z.ZodObject, name: string): FieldConstraints => {
  const field = schema.shape?.[name]
  if (!field) {
    return {}
  }

  const checks = unwrap(field)?._zod?.def?.checks ?? []
  const out: FieldConstraints = {}
  for (const check of checks) {
    const def = check?._zod?.def
    if (!def) {
      continue
    }
    if (def.check === 'min_length') {
      out.minLength = def.minimum
    }
    if (def.check === 'max_length') {
      out.maxLength = def.maximum
    }
    if (def.check === 'greater_than') {
      out.min = def.value
    }
    if (def.check === 'less_than') {
      out.max = def.value
    }
  }
  return out
}
