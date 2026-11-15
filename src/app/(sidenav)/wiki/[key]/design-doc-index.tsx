'use client'

import { PanelSkeleton } from '@/components/general/panel'
import { DesignDocListView } from '@/components/markdown/design-doc-view'
import { useActionData } from '@/lib/action/action-client'
import { useLocale } from '@/locale/client'
import type { DesignDocListDocument } from 'markdown-design-doc-viewer-embed/react'
import { FC, useEffect, useMemo, useRef } from 'react'
import { getWikiDesignDocIndex } from './server'
import { useWikiSpace } from './space-context'

/**
 * 設計書スペースのトップの設計書一覧。親ページのタイトルのパスをフォルダ、ページ番号をファイル名として、
 * ツリーの並び(親の次にその子孫)のまま embed の一覧に渡す
 */
export const WikiDesignDocIndex: FC = () => {
  const { t } = useLocale()
  const { space, tree } = useWikiSpace()
  const { data, isLoading, refresh } = useActionData(() => getWikiDesignDocIndex({ id: space.id }), { key: space.id })

  // ツリーを取り直したとき(ページの作成・移動・削除・改名、リロード)は一覧も取り直す
  const shownTree = useRef(tree)
  useEffect(() => {
    if (shownTree.current !== tree) {
      shownTree.current = tree
      void refresh()
    }
  }, [tree, refresh])

  const documents = useMemo(() => {
    if (!data) {
      return []
    }
    const byId = new Map(data.map((doc) => [doc.id, doc]))
    const titleOf = new Map(tree.map((page) => [page.id, page.title]))
    const childrenOf = new Map<string | null, string[]>()
    for (const page of tree) {
      childrenOf.set(page.parentId, [...(childrenOf.get(page.parentId) ?? []), page.id])
    }
    const list: DesignDocListDocument[] = []
    const visit = (parentId: string | null, path: string[]) => {
      for (const id of childrenOf.get(parentId) ?? []) {
        const doc = byId.get(id)
        if (doc) {
          list.push({
            markdown: doc.frontMatter,
            href: `/wiki/${space.key}/${doc.number}`,
            folder: path.join('/'),
            file: `#${doc.number}`,
            title: doc.title,
          })
        }
        visit(id, [...path, titleOf.get(id) ?? ''])
      }
    }
    visit(null, [])
    return list
  }, [data, tree, space.key])

  if (isLoading) {
    return <PanelSkeleton />
  }
  return (
    <DesignDocListView
      documents={documents}
      title={t('wiki_design_docs')}
      fileLabel={t('wiki_page_number')}
      filterPlaceholder={t('wiki_design_doc_filter')}
      empty={t('msg_no_wiki_design_docs')}
    />
  )
}
