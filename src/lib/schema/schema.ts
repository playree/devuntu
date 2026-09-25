/**
 * 複数のドメインで使う入力スキーマの部品
 *
 * ドメインごとのスキーマは `schema-*.ts` を参照。
 */

import { el } from '@/locale'
import { z } from 'zod'

export const zName = z.string().min(2, el('@invalid_name')).max(30, el('@invalid_name'))
export const zEmail = z.email(el('@invalid_email'))
/**
 * パスワード。パスフレーズやパスワードマネージャの生成値を弾かないよう、文字種は制限せず長さだけを見る。
 * 上限は better-auth の maxPasswordLength(既定 128)に合わせる。
 */
export const zPassword = z.string().min(8, el('@invalid_password')).max(128, el('@invalid_password'))
export const zDescription = z.string().max(40, el('@invalid_description')).optional()

/** アップロード画像の上限。クライアント側の入力チェックにも使うので export する */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const zImageFile = z
  .instanceof(File, { message: el('@required_field') })
  .refine((file) => file.size <= MAX_IMAGE_SIZE, el('@invalid_image_size'))
  .refine((file) => ACCEPTED_IMAGE_TYPES.includes(file.type), el('@invalid_image_type'))

export const scUUID = z.object({
  id: z.uuidv7(),
})

/** 並び順の向き。HeroUI の SortDescriptor と同じ値 */
export const zSortDirection = z.enum(['ascending', 'descending'])
export type SortDirection = z.infer<typeof zSortDirection>

/**
 * 一覧のページングと並び順。`columns` は並べ替えできる列名、`defaultColumn` は既定の列。
 *
 * 並び順はテーブルのヘッダ操作(HeroUI の SortDescriptor)由来の任意の文字列として渡ってくるので、
 * string を受けてから列名へ絞り、想定外の値はエラーにせず既定へ落として一覧が壊れないようにする。
 */
export const zPagingFields = <const T extends readonly [string, ...string[]]>(
  columns: T,
  defaultColumn: T[number],
) => ({
  page: z.number().int().min(1).default(1),
  // 上限は ROWS_PER_PAGE_OPTIONS(components/general/paging.ts)の最大値に合わせる
  rowsPerPage: z.number().int().min(1).max(100).default(10),
  sortColumn: z.string().default(defaultColumn).pipe(z.enum(columns).catch(defaultColumn)),
  sortDirection: z.string().default('descending').pipe(zSortDirection.catch('descending')),
})
