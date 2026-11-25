'use client'

import { GridBox } from '@/components/general/grid'
import { DialogModal, type ModalBaseProps } from '@/components/general/modal'
import { SingleSelectField } from '@/components/general/select'
import { FolderArrowRightIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { MAX_WIKI_DEPTH, WIKI_TREE_CHANGED } from '@/lib/wiki/wiki-rule'
import { depthOf, indexWikiTree, isSelfOrDescendant, planWikiMove, subtreeHeight } from '@/lib/wiki/wiki-tree'
import { useLocale } from '@/locale/client'
import { FC, useMemo, useState } from 'react'
import { moveWikiPage } from './server'
import { useWikiSpace } from './space-context'

const ROOT_KEY = '__root__'
const FIRST_KEY = '__first__'
const LAST_KEY = '__last__'

/**
 * ページの移動。親(スペース直下か別のページ)と、兄弟の中での位置を選ぶ。
 * 自分と子孫、移すと深さの上限を超えるページは親の候補から除く
 */
export const MovePageModal: FC<ModalBaseProps & { page: { id: string; title: string; parentId: string | null } }> = ({
  state,
  reload,
  page,
}) => {
  const { t } = useLocale()
  const { space, tree } = useWikiSpace()
  const index = useMemo(() => indexWikiTree(tree), [tree])

  // 今の親と兄弟の並び(自分を含む)は木から取る。ページ詳細の page は、ツリー側での移動の後に古いままになりうるため
  const currentParentId = index.byId.has(page.id) ? (index.byId.get(page.id)?.parentId ?? null) : page.parentId
  const currentIds = useMemo(() => index.children.get(currentParentId) ?? [], [index, currentParentId])
  const initialPositionKey = useMemo(() => {
    const at = currentIds.indexOf(page.id)
    return at > 0 ? currentIds[at - 1] : FIRST_KEY
  }, [currentIds, page.id])

  const [parentKey, setParentKey] = useState(currentParentId ?? ROOT_KEY)
  const [positionKey, setPositionKey] = useState(initialPositionKey)
  const [isPending, setPending] = useState(false)

  const parentOptions = useMemo(() => {
    const height = subtreeHeight(index, page.id)
    const options: Record<string, string> = { [ROOT_KEY]: t('wiki_space_root', { name: space.name }) }
    for (const item of tree) {
      if (isSelfOrDescendant(index, page.id, item.id) || depthOf(index, item.id) + height > MAX_WIKI_DEPTH) {
        continue
      }
      // 選択肢は平らな一覧なので、深さを全角空白の字下げで見せる
      options[item.id] = `${'　'.repeat(depthOf(index, item.id) - 1)}${item.title}`
    }
    return options
  }, [index, page.id, space.name, t, tree])

  // 兄弟の並びは木を上から読んだ順(サーバーが兄弟の表示順で返している)
  const parentId = parentKey === ROOT_KEY ? null : parentKey
  const siblings = tree.filter((item) => item.parentId === parentId && item.id !== page.id)
  const positionOptions: Record<string, string> = {
    [FIRST_KEY]: t('wiki_position_first'),
    [LAST_KEY]: t('wiki_position_last'),
    ...Object.fromEntries(siblings.map((item) => [item.id, t('wiki_position_after', { title: item.title })])),
  }

  const requestedAfterId = positionKey === FIRST_KEY ? null : positionKey === LAST_KEY ? undefined : positionKey
  const { afterId, isUnchanged } = planWikiMove(index, page.id, currentParentId, parentId, requestedAfterId)
  const selectedKey = afterId === null ? FIRST_KEY : (afterId ?? LAST_KEY)

  const submit = async () => {
    setPending(true)
    try {
      const res = await parseAction(moveWikiPage({ id: page.id, parentId, afterId }))
      // 開いた後に別の操作で同じ位置へ動いていれば unchanged が返る。動かしていないので通知しない
      if (res.result === 'moved') {
        notify.success(t('msg_moved_target', { target: page.title }))
      }
      reload()
      state.close()
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
      // 選んだ「◯◯ の後」のページが移された・消された。取り直して、開いたまま選び直してもらう
      if (e.errorType === WIKI_TREE_CHANGED) {
        reload()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogModal
      state={state}
      title={{ text: t('wiki_move_page'), icon: <FolderArrowRightIcon /> }}
      submit={{ label: t('wiki_move'), isPending, isDisabled: isUnchanged, onPress: submit }}
    >
      <GridBox isSmart>
        <p className='col-span-12 truncate text-sm font-semibold'>{page.title}</p>
        <div className='col-span-12'>
          <SingleSelectField
            label={t('wiki_parent')}
            groupOptions={parentOptions}
            value={parentKey}
            onChange={(key) => {
              const nextKey = key ?? ROOT_KEY
              setParentKey(nextKey)
              setPositionKey(nextKey === (currentParentId ?? ROOT_KEY) ? initialPositionKey : LAST_KEY)
            }}
          />
        </div>
        <div className='col-span-12'>
          <SingleSelectField
            label={t('wiki_position')}
            groupOptions={positionOptions}
            value={selectedKey}
            onChange={(key) => setPositionKey(key ?? LAST_KEY)}
          />
        </div>
      </GridBox>
    </DialogModal>
  )
}
