import { notify } from '@/components/notify'
import { useActionData } from '@/lib/action/action-client'
import { resolveWikiRevisionTags } from '@/lib/wiki/wiki-rule'
import { useLocale } from '@/locale/client'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { getWikiPageRevisionContent, getWikiPageRevisions, type GetWikiPageRevisionsReturnType } from '../server'
import { useWikiSpace } from '../space-context'
import type { GetWikiPageReturnType } from './server'

type Page = NonNullable<GetWikiPageReturnType>['page']
export type WikiPageRevision = NonNullable<GetWikiPageRevisionsReturnType>['revisions'][number]

/**
 * ページの版の一覧と、選んでいる版。最新の版はいまの内容と同じなので、過去の版(`past`)を選んだときだけ本文を引く。
 * 一覧は同じ時点のページの更新日時を持つので、表示中のページと照合し、ずれていれば古いほう(一覧かページ)を取り直す。
 * 移動は更新日時を進めずに版だけを足すので、更新日時が同じなら最新の版の番号で比べる。
 * そろうまでは一覧を出さない(版の表示と内容が別の版を指さないように)
 */
export const useWikiPageRevisions = (page: Page, reloadPage: () => Promise<void>) => {
  const { t } = useLocale()
  const { data, refresh } = useActionData(() => getWikiPageRevisions({ id: page.id }), { key: page.id })
  const updatedAt = page.updatedAt.getTime()
  const listPageAt = data ? (data.pageUpdatedAt?.getTime() ?? null) : undefined
  const listRevisionNumber = data?.revisions[0]?.number ?? 0
  const isSynced = listPageAt === updatedAt && listRevisionNumber === page.revisionNumber
  /**
   * 取り直しは、ページか一覧を新しく受け取るたびに1回だけ行う。取得に失敗すると前の値のまま残るので、失敗しても繰り返さない。
   * 画面の再読み込みボタンでページを取り直せば(更新日時が同じでも)もう一度試す
   */
  const tried = useRef<{ page: Page; list: typeof data } | null>(null)
  const syncLatest = useEffectEvent((older: 'list' | 'page') => (older === 'list' ? refresh() : reloadPage()))
  useEffect(() => {
    if (listPageAt === undefined || isSynced) {
      return
    }
    if (tried.current?.page !== page || tried.current.list !== data) {
      tried.current = { page, list: data }
      // 一覧のほうが新しい(他の人の保存・移動・ページの削除)ならページを、ページのほうが新しい(保存・ロールバック・移動)なら一覧を取り直す
      const isListNewer =
        listPageAt === null ||
        listPageAt > updatedAt ||
        (listPageAt === updatedAt && listRevisionNumber > page.revisionNumber)
      void syncLatest(isListNewer ? 'page' : 'list')
    }
  }, [listPageAt, listRevisionNumber, updatedAt, isSynced, page, data])
  const reload = async () => {
    await Promise.all([refresh(), reloadPage()])
  }

  const revisions = isSynced && data ? data.revisions : []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 選んだ過去の版から最新への差分を出すか。過去の版を選び直しても保ち、選択を外すと戻す
  const [isDiffOn, setDiffOn] = useState(false)
  // 選び直すたびに本文を引き直す(同じ版を選び直したときも、前回の失敗を引きずらない)
  const [attempt, setAttempt] = useState(0)
  // 一覧から消えた版(削除・掃除)を選んでいたら最新に戻る
  const selected = revisions.find(({ id }) => id === selectedId)
  const past = selected && selected.id !== revisions[0]?.id ? selected : undefined
  const contentKey = past ? `${past.id}#${attempt}` : undefined
  const content = useActionData(() => getWikiPageRevisionContent({ id: past?.id ?? '' }), {
    skip: !past,
    key: contentKey,
  })
  // 本文を引けなかった(他の人の削除や掃除で版が消えた)ら、最新に戻して取り直す
  const [missingKey, setMissingKey] = useState<string | null>(null)
  if (contentKey && !content.isLoading && content.data === undefined && missingKey !== contentKey) {
    setMissingKey(contentKey)
    setSelectedId(null)
    setDiffOn(false)
  }
  const onMissing = useEffectEvent(() => {
    notify.error(t('msg_invalid_operation'))
    void reload()
  })
  useEffect(() => {
    if (missingKey) {
      onMissing()
    }
  }, [missingKey])

  return {
    revisions,
    retention: data,
    past,
    pastContent: past ? content.data : undefined,
    isDiff: isDiffOn && !!past,
    setDiff: setDiffOn,
    // 最新の版を選んだときは選択を外す(新しい版ができても最新を表示し続ける)
    select: (id: string | null) => {
      const next = id === revisions[0]?.id ? null : id
      if (next !== selectedId) {
        setSelectedId(next)
        setAttempt((n) => n + 1)
      }
      // 最新の表示から(版が消えて戻った場合も含む)選んだときは、差分ではなく版の内容から始める
      if (next === null || !past) {
        setDiffOn(false)
      }
    },
    reload,
  }
}

export type WikiPageRevisions = ReturnType<typeof useWikiPageRevisions>

/** 版の内容(過去の版)で表示するタイトル・種類・タグ。タグは ID で、いまスペースに残っているものを今の名前で出す */
export const usePastPageView = (past: WikiPageRevision | undefined) => {
  const { tags } = useWikiSpace()
  if (!past) {
    return undefined
  }
  return {
    id: past.id,
    number: past.number,
    revisionTags: past.tags,
    title: past.title,
    type: past.type,
    tags: resolveWikiRevisionTags(past.tags, tags),
  }
}
