/**
 * 画像を挿入できる本文と、添付の掃除の参照元の対応を突き合わせるガード
 *
 * Markdown エディタは `allowImages` を付けたときだけ画像をアップロードできる。
 * 付けた本文の保存先が `src/lib/storage/attachment-ref.ts` の参照元に無いと、
 * 貼った画像は猶予を過ぎると「どこからも参照されていない」とみなされて消える。
 * `allowImages` を付けたファイルを走査し、下の一覧と一致することを確かめる。
 */

import type { AttachmentRefSource } from '@/lib/storage/attachment-ref'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** `allowImages` を付けているファイル → 保存先を拾う参照元 */
const IMAGE_EDITORS: Record<string, AttachmentRefSource> = {
  'src/app/(sidenav)/tickets/[id]/ticket-body.tsx': 'ticket',
  'src/app/(sidenav)/tickets/modals.tsx': 'ticket',
  'src/app/(sidenav)/tickets/[id]/comment-item.tsx': 'comment',
  'src/app/(sidenav)/tickets/[id]/comments.tsx': 'comment',
  // 差し戻し理由はコメントとして保存される
  'src/app/(sidenav)/tickets/[id]/decision-buttons.tsx': 'comment',
  'src/app/(sidenav)/boards/[id]/settings/board-ticket-templates.tsx': 'ticketTemplate',
  'src/app/(sidenav)/admin/dashboard/announcement-edit.tsx': 'announcement',
}

const rootDir = fileURLToPath(new URL('../../../', import.meta.url))

/** エディタ本体と生成物は対象外 */
const EXCLUDED_DIRS = ['src/components/markdown', 'src/generated']

/** `allowImages={false}` は既定と同じなので、許可として数えない */
const ALLOW_IMAGES = /\ballowImages(?!=\{false\})/

const listTsx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    const rel = relative(rootDir, path)
    if (entry.isDirectory()) {
      return EXCLUDED_DIRS.includes(rel) ? [] : listTsx(path)
    }
    return entry.name.endsWith('.tsx') ? [rel] : []
  })

describe('画像を挿入できる本文', () => {
  it('allowImages を付けたファイルが一覧と一致する(足したら attachment-ref.ts の参照元に加え、この一覧に登録する)', () => {
    const actual = listTsx(join(rootDir, 'src'))
      .filter((file) => ALLOW_IMAGES.test(readFileSync(join(rootDir, file), 'utf8')))
      .sort()

    expect(actual).toEqual(Object.keys(IMAGE_EDITORS).sort())
  })
})
