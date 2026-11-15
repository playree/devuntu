/**
 * 設計書スペースのトップの設計書一覧(mddv の embed の DesignDocList)に渡す文書の組み立て
 */

import type { DesignDocListDocument } from 'markdown-design-doc-viewer-embed/react'
import type { WikiDesignDocIndexItem } from './wiki-design-doc-index'

/** フォルダ名の1階層。embed は `/` を階層の区切りとして扱うので、タイトルの `/` は全角にする */
const folderSegment = (title: string) => title.replaceAll('/', '／')

/**
 * ツリーの並び(親の次にその子孫)の一覧。親ページのタイトルのパスをフォルダ、ページ番号をファイル名にする。
 * 同じパスになる親ページが複数あると表がまとまってしまうので、2つ目以降はパスの末尾に番号を付けて分ける
 * (付けた名前も使われていれば、さらに付ける)
 */
export const toDesignDocListDocuments = (
  spaceKey: string,
  docs: readonly WikiDesignDocIndexItem[],
): DesignDocListDocument[] => {
  const ids = new Set(docs.map(({ id }) => id))
  const childrenOf = new Map<string | null, WikiDesignDocIndexItem[]>()
  for (const doc of docs) {
    // 親が一覧に無い(設計書でない)ときは最上位に置く
    const parentId = doc.parentId && ids.has(doc.parentId) ? doc.parentId : null
    const siblings = childrenOf.get(parentId)
    if (siblings) {
      siblings.push(doc)
    } else {
      childrenOf.set(parentId, [doc])
    }
  }
  const folders = new Set<string>([''])
  const list: DesignDocListDocument[] = []
  const visit = (parentId: string | null, folder: string) => {
    for (const doc of childrenOf.get(parentId) ?? []) {
      list.push({
        markdown: doc.frontMatter,
        href: `/wiki/${spaceKey}/${doc.number}`,
        folder,
        file: `#${doc.number}`,
        title: doc.title,
      })
      if (childrenOf.has(doc.id)) {
        let child = [folder, folderSegment(doc.title)].filter(Boolean).join('/')
        // 番号を付けた名前が別の親のタイトルと同じこともあるので、使われていない名前になるまで付ける
        while (folders.has(child)) {
          child = `${child} (#${doc.number})`
        }
        folders.add(child)
        visit(doc.id, child)
      }
    }
  }
  visit(null, '')
  return list
}
