import { auth } from '@/lib/auth'
import { getSchema } from 'better-auth/db'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Better Auth（有効化されたプラグイン）が要求するDBスキーマと、
 * prisma/schema.prisma の定義が一致しているかを検証する。
 *
 * 背景: @better-auth/oauth-provider 1.6.23 で redirectUris 等が
 *   `string` -> `string[]` に変わったが Prisma スキーマが `String` のままで、
 *   OIDCクライアント作成が `Expected String, provided (String)` で失敗した。
 *   このテストは、そうした「型不整合」「フィールド欠落」を
 *   better-auth アップグレード時に検知することを目的とする。
 */

// Better Auth のフィールド型 -> 許容される Prisma のスカラー型（base）
const BETTER_AUTH_TO_PRISMA_BASE: Record<string, string[]> = {
  string: ['String'],
  number: ['Int', 'BigInt', 'Float', 'Decimal'],
  boolean: ['Boolean'],
  date: ['DateTime'],
  json: ['Json'],
}

type PrismaField = { base: string; isArray: boolean; optional: boolean }

/** prisma/schema.prisma を軽量パースし、モデル毎のフィールド型を得る。 */
function parsePrismaModels(src: string): Record<string, Record<string, PrismaField>> {
  const models: Record<string, Record<string, PrismaField>> = {}
  const modelRe = /model\s+(\w+)\s*\{\n([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(src)) !== null) {
    const ident = m[1]
    const body = m[2]
    // Better Auth のモデルキー（camelCase / Prisma クライアントのプロパティ名）に合わせる
    const key = ident.charAt(0).toLowerCase() + ident.slice(1)
    const fields: Record<string, PrismaField> = {}
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('//') || line.startsWith('@@')) {
        continue
      }
      const fm = line.match(/^(\w+)\s+([A-Za-z0-9_]+(?:\?|\[\])?)/)
      if (!fm) {
        continue
      }
      const [, name, typeToken] = fm
      fields[name] = {
        base: typeToken.replace(/[?[\]]/g, ''),
        isArray: typeToken.endsWith('[]'),
        optional: typeToken.endsWith('?'),
      }
    }
    models[key] = fields
  }
  return models
}

const schemaPath = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url))
const prismaModels = parsePrismaModels(readFileSync(schemaPath, 'utf8'))
const expectedSchema = getSchema(auth.options)

describe('Better Auth スキーマと Prisma スキーマの整合性', () => {
  it('Better Auth が要求する全モデルが Prisma スキーマに存在する', () => {
    const missing = Object.keys(expectedSchema).filter((model) => !prismaModels[model])
    expect(missing, `Prisma スキーマに欠落しているモデル: ${missing.join(', ')}`).toEqual([])
  })

  // 各モデルを個別テストにし、失敗時にどのモデルかが分かるようにする
  for (const [model, def] of Object.entries(expectedSchema)) {
    it(`${model}: フィールドの型・配列種別が一致する`, () => {
      const prismaFields = prismaModels[model]
      expect(prismaFields, `Prisma スキーマにモデル "${model}" が存在しない`).toBeTruthy()
      if (!prismaFields) {
        return
      }

      const errors: string[] = []
      for (const [fieldName, attr] of Object.entries(def.fields)) {
        // fieldName の @map 上書きがあれば優先（この実装では未使用だが将来のため）
        const column = attr.fieldName ?? fieldName
        const pf = prismaFields[column]
        if (!pf) {
          errors.push(`- ${column}: Prisma に存在しない（Better Auth: ${attr.type}）`)
          continue
        }

        const baType = String(attr.type)
        const baIsArray = baType.endsWith('[]')
        const baBase = baIsArray ? baType.slice(0, -2) : baType
        const allowedBases = BETTER_AUTH_TO_PRISMA_BASE[baBase]

        // 必須/オプション（nullable）の整合。Better Auth の required は省略時 true（NOT NULL）扱い。
        // スカラー配列は Prisma では NOT NULL の `T[] @default([])`（空配列が「無し」）で表現され、
        // Better Auth の optional とは意味が異なるため対象外とする。
        if (!baIsArray) {
          const baRequired = attr.required !== false
          const prismaRequired = !pf.optional
          if (baRequired !== prismaRequired) {
            errors.push(
              `- ${column}: 必須/オプションが不一致（Better Auth: ${baRequired ? 'required' : 'optional'} / Prisma: ${prismaRequired ? 'required' : 'optional'}）`,
            )
          }
        }

        if (!allowedBases) {
          // 未知の Better Auth 型（将来の追加）。チェックをスキップせず気づけるようにする
          errors.push(`- ${column}: 未知の Better Auth 型 "${baType}"（テストのマッピング更新が必要）`)
          continue
        }
        if (baIsArray !== pf.isArray) {
          errors.push(
            `- ${column}: 配列種別が不一致（Better Auth: ${baType} / Prisma: ${pf.base}${pf.isArray ? '[]' : ''}）`,
          )
          continue
        }
        if (!allowedBases.includes(pf.base)) {
          errors.push(
            `- ${column}: 型が不一致（Better Auth: ${baType} -> ${allowedBases.join('|')} を期待 / Prisma: ${pf.base}）`,
          )
        }
      }

      expect(errors, `モデル "${model}" のスキーマ不整合:\n${errors.join('\n')}`).toEqual([])
    })
  }
})
