import { auth } from '@/lib/auth/auth'
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
/** `@@unique` / `@@index` とフィールド属性の `@unique` / `@index` を同じ形で持つ。 */
type PrismaIndex = { columns: string[]; unique: boolean }
type PrismaModel = { fields: Record<string, PrismaField>; indexes: PrismaIndex[] }

/** prisma/schema.prisma を軽量パースし、モデル毎のフィールド型と複合インデックスを得る。 */
function parsePrismaModels(src: string): Record<string, PrismaModel> {
  const models: Record<string, PrismaModel> = {}
  const modelRe = /model\s+(\w+)\s*\{\n([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(src)) !== null) {
    const ident = m[1]
    const body = m[2]
    // Better Auth のモデルキー（camelCase / Prisma クライアントのプロパティ名）に合わせる
    const key = ident.charAt(0).toLowerCase() + ident.slice(1)
    const fields: Record<string, PrismaField> = {}
    const indexes: PrismaIndex[] = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (line === '' || line.startsWith('//')) {
        continue
      }
      if (line.startsWith('@@')) {
        const im = line.match(/^@@(unique|index)\(\[([^\]]*)\]/)
        if (im) {
          indexes.push({
            columns: im[2].split(',').map((column) => column.trim()),
            unique: im[1] === 'unique',
          })
        }
        continue
      }
      const fm = line.match(/^(\w+)\s+([A-Za-z0-9_]+(?:\?|\[\])?)/)
      if (!fm) {
        continue
      }
      const [, name, typeToken] = fm
      // 単一カラムの制約はフィールド属性でも書けるので、@@unique / @@index と同じ扱いで拾う
      if (/@unique\b/.test(line)) {
        indexes.push({ columns: [name], unique: true })
      } else if (/@index\b/.test(line)) {
        indexes.push({ columns: [name], unique: false })
      }
      fields[name] = {
        base: typeToken.replace(/[?[\]]/g, ''),
        isArray: typeToken.endsWith('[]'),
        optional: typeToken.endsWith('?'),
      }
    }
    models[key] = { fields, indexes }
  }
  return models
}

/**
 * Prisma 側に該当のインデックスがあるか。
 * unique を要求されている場合のみ unique であることまで求める(unique 索引は index の要求も満たす)。
 */
function hasIndex(model: PrismaModel, columns: readonly string[], unique: boolean) {
  return model.indexes.some((actual) => actual.columns.join(',') === columns.join(',') && (!unique || actual.unique))
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
      const prismaModel = prismaModels[model]
      expect(prismaModel, `Prisma スキーマにモデル "${model}" が存在しない`).toBeTruthy()
      if (!prismaModel) {
        return
      }
      const prismaFields = prismaModel.fields

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

  // Better Auth 1.7 の account `(issuer, accountId)` のように、
  // フィールドではなく複合インデックスだけが増えるケースを検知する
  for (const [model, def] of Object.entries(expectedSchema)) {
    const expectedIndexes = def.indexes ?? []
    if (expectedIndexes.length === 0) {
      continue
    }
    it(`${model}: 要求される複合インデックスが存在する`, () => {
      const prismaModel = prismaModels[model]
      expect(prismaModel, `Prisma スキーマにモデル "${model}" が存在しない`).toBeTruthy()
      if (!prismaModel) {
        return
      }

      const missing = expectedIndexes
        .filter((expected) => !hasIndex(prismaModel, expected.columns, !!expected.unique))
        .map((expected) => `- ${expected.unique ? '@@unique' : '@@index'}([${expected.columns.join(', ')}])`)

      expect(missing, `モデル "${model}" に不足しているインデックス:\n${missing.join('\n')}`).toEqual([])
    })
  }

  // 単一カラムの制約は def.indexes ではなくフィールド属性(unique / index)で表現されるため、
  // 複合インデックスの検証とは別に突き合わせる
  for (const [model, def] of Object.entries(expectedSchema)) {
    it(`${model}: 要求される単一カラムの制約が存在する`, () => {
      const prismaModel = prismaModels[model]
      expect(prismaModel, `Prisma スキーマにモデル "${model}" が存在しない`).toBeTruthy()
      if (!prismaModel) {
        return
      }

      const missing: string[] = []
      for (const [fieldName, attr] of Object.entries(def.fields)) {
        const column = attr.fieldName ?? fieldName
        if (attr.unique && !hasIndex(prismaModel, [column], true)) {
          missing.push(`- @@unique([${column}])`)
          continue
        }
        if (attr.index && !hasIndex(prismaModel, [column], false)) {
          missing.push(`- @@index([${column}])`)
        }
      }

      expect(missing, `モデル "${model}" に不足している制約:\n${missing.join('\n')}`).toEqual([])
    })
  }
})
