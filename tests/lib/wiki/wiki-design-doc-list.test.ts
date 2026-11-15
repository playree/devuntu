/**
 * 設計書一覧に渡す文書の組み立て(wiki-design-doc-list.ts)
 */

import type { WikiDesignDocIndexItem } from '@/lib/wiki/wiki-design-doc-index'
import { toDesignDocListDocuments } from '@/lib/wiki/wiki-design-doc-list'
import { describe, expect, it } from 'vitest'

const doc = (number: number, title: string, parentId: string | null = null): WikiDesignDocIndexItem => ({
  id: `p${number}`,
  parentId,
  number,
  title,
  frontMatter: `---\ntitle: ${title}\n---\n`,
})

const shape = (docs: WikiDesignDocIndexItem[]) =>
  toDesignDocListDocuments('SPEC', docs).map(({ folder, file }) => `${folder}|${file}`)

describe('toDesignDocListDocuments', () => {
  it('親の次にその子孫を並べ、親ページのタイトルのパスをフォルダ、ページ番号をファイル名にする', () => {
    const docs = [doc(1, '基本設計'), doc(2, '画面', 'p1'), doc(3, 'ログイン', 'p2'), doc(4, '詳細設計')]

    expect(toDesignDocListDocuments('SPEC', docs)[2]).toEqual({
      markdown: '---\ntitle: ログイン\n---\n',
      href: '/wiki/SPEC/3',
      folder: '基本設計/画面',
      file: '#3',
      title: 'ログイン',
    })
    expect(shape(docs)).toEqual(['|#1', '基本設計|#2', '基本設計/画面|#3', '|#4'])
  })

  it('タイトルの / は全角にして、階層の区切りと取り違えさせない', () => {
    expect(shape([doc(1, 'v1/v2 移行'), doc(2, '手順', 'p1')])).toEqual(['|#1', 'v1／v2 移行|#2'])
  })

  it('同じパスになる親ページが複数あれば、2つ目以降は番号を付けて表を分ける', () => {
    const docs = [doc(1, 'API'), doc(2, '取得', 'p1'), doc(5, 'API'), doc(6, '更新', 'p5')]
    expect(shape(docs)).toEqual(['|#1', 'API|#2', '|#5', 'API (#5)|#6'])
  })

  it('親が一覧に無いページは最上位に置く', () => {
    expect(shape([doc(2, '子', 'gone')])).toEqual(['|#2'])
  })
})
