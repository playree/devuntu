'use client'

import { NoticePanel, PanelSkeleton } from '@/components/general/panel'
import { DesignDocListView } from '@/components/markdown/design-doc-view'
import { useActionData } from '@/lib/action/action-client'
import { toDesignDocListDocuments } from '@/lib/wiki/wiki-design-doc-list'
import { useLocale } from '@/locale/client'
import { FC, useEffect, useMemo, useRef } from 'react'
import { getWikiDesignDocIndex } from './server'
import { useWikiSpace } from './space-context'

/** 設計書スペースのトップの設計書一覧 */
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

  // 取り直したときだけ作り直す(embed の一覧は渡す配列が変わると描き直す)
  const documents = useMemo(() => (data ? toDesignDocListDocuments(space.key, data) : []), [data, space.key])

  return (
    <div // 設計書ページと同じく、表を広く見せるため幅の制限(max-w-4xl)を外す
      data-wide=''
    >
      {isLoading ? (
        <PanelSkeleton />
      ) : data ? (
        <DesignDocListView
          documents={documents}
          title={t('wiki_design_docs')}
          fileLabel={t('wiki_page_number')}
          filterPlaceholder={t('wiki_design_doc_filter')}
          empty={t('msg_no_wiki_design_docs')}
        />
      ) : (
        <NoticePanel // 取得に失敗した(空の一覧と区別する)
          status='danger'
        >
          {t('msg_wiki_design_docs_load_failed')}
        </NoticePanel>
      )}
    </div>
  )
}
