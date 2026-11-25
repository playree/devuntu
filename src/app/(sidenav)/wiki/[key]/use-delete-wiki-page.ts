import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { WIKI_TREE_CHANGED } from '@/lib/wiki/wiki-rule'
import { descendantIds, indexWikiTree } from '@/lib/wiki/wiki-tree'
import { useLocale } from '@/locale/client'
import { useRouter } from 'next/navigation'
import { deleteWikiPage } from './server'
import { useWikiSpace } from './space-context'

/**
 * ページの削除。子孫があれば件数を示して確認し、配下ごと消す。
 * 戻り値の関数は、消した後に移る先(親かスペースのトップ)と、ツリーが変わっていて消さなかったときの取り直しを受け取る
 */
export const useDeleteWikiPage = () => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()
  const { tree, reloadSpace } = useWikiSpace()

  return async (page: { id: string; title: string }, afterHref: string, reload: () => Promise<void> = reloadSpace) => {
    const ids = descendantIds(indexWikiTree(tree), page.id)
    const descendants = ids.length
    await confirmAction(
      {
        title: t('confirm_deletion'),
        text:
          descendants > 0
            ? t('msg_confirm_delete_wiki_page_with_children', { target: page.title, count: descendants })
            : t('msg_confirm_deletion', { target: page.title }),
      },
      async () => {
        try {
          const { deleted } = await parseAction(deleteWikiPage({ id: page.id, descendantIds: ids }))
          notify.success(t('msg_deleted_wiki_pages', { target: page.title, count: deleted }))
          router.push(afterHref)
          await reloadSpace()
        } catch (e) {
          // 確認で見せた配下と今の配下が違えば消していない。取り直して、新しい件数で確認し直せるようにする
          if (e instanceof ClientError && e.errorType === WIKI_TREE_CHANGED) {
            await reload()
          }
          throw e
        }
      },
    )
  }
}
