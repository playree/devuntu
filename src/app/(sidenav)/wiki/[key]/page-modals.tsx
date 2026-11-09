'use client'

import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { DialogModal, FormModal, type ModalBaseProps } from '@/components/general/modal'
import { SingleSelectField } from '@/components/general/select'
import { ArrowRightCircleIcon, DocumentPlusIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { ClientError } from '@/lib/error'
import { type CreateWikiPage, scCreateWikiPage } from '@/lib/schema/schema-wiki'
import { useConfirmAction } from '@/lib/use-confirm-action'
import { MAX_WIKI_DEPTH } from '@/lib/wiki/wiki-rule'
import { depthOf, descendantIds, indexWikiTree, isSelfOrDescendant, subtreeHeight } from '@/lib/wiki/wiki-tree'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { createWikiPage, deleteWikiPage, moveWikiPage } from './server'
import { useWikiSpace } from './space-context'

/** 作成後に本文の編集から始めるため、ページ詳細へ付けるクエリ */
export const EDIT_QUERY = 'edit'

/** ページの作成。タイトルだけを入れて作り、作ったページへ移って本文の編集を始める */
export const CreatePageModal: FC<ModalBaseProps & { parent: { id: string; title: string } | null }> = ({
  state,
  reload,
  parent,
}) => {
  const { t, fet } = useLocale()
  const router = useRouter()
  const { space } = useWikiSpace()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CreateWikiPage>({
    resolver: zodResolver(scCreateWikiPage),
    mode: 'onChange',
    defaultValues: { spaceId: space.id, parentId: parent?.id ?? null, title: '' },
  })

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createWikiPage(req))
          notify.success(t('msg_added_target', { target: req.title }))
          reload()
          state.close()
          router.push(`/wiki/${space.key}/${res.number}?${EDIT_QUERY}=1`)
        } catch (e) {
          // 深さの上限などは parseAction が通知済み。入力し直してもらうため画面はそのまま残す
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
      title={{ text: parent ? t('wiki_add_child_page') : t('wiki_add_page'), icon: <DocumentPlusIcon /> }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        {parent && (
          <p className='text-muted col-span-12 truncate text-sm'>{t('wiki_parent_page', { title: parent.title })}</p>
        )}
        <div className='col-span-12'>
          <InputCtrl
            control={control}
            name='title'
            constraintSchema={scCreateWikiPage}
            label={t('wiki_page_title')}
            errorMessage={fet(errors.title)}
            autoFocus
          />
        </div>
      </GridBox>
    </FormModal>
  )
}

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
  const [parentKey, setParentKey] = useState(page.parentId ?? ROOT_KEY)
  const [positionKey, setPositionKey] = useState(LAST_KEY)
  const [isPending, setPending] = useState(false)

  const index = useMemo(() => indexWikiTree(tree), [tree])

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

  const submit = async () => {
    const position =
      positionKey === FIRST_KEY
        ? 0
        : positionKey === LAST_KEY
          ? undefined
          : siblings.findIndex((item) => item.id === positionKey) + 1
    setPending(true)
    try {
      await parseAction(moveWikiPage({ id: page.id, parentId, position }))
      notify.success(t('msg_saved'))
      reload()
      state.close()
    } catch (e) {
      if (!(e instanceof ClientError)) {
        throw e
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogModal
      state={state}
      title={{ text: t('wiki_move_page'), icon: <ArrowRightCircleIcon /> }}
      submit={{ label: t('wiki_move'), isPending, onPress: submit }}
    >
      <GridBox isSmart>
        <p className='col-span-12 truncate text-sm font-semibold'>{page.title}</p>
        <div className='col-span-12'>
          <SingleSelectField
            label={t('wiki_parent')}
            groupOptions={parentOptions}
            value={parentKey}
            onChange={(key) => {
              setParentKey(key ?? ROOT_KEY)
              setPositionKey(LAST_KEY)
            }}
          />
        </div>
        <div className='col-span-12'>
          <SingleSelectField
            label={t('wiki_position')}
            groupOptions={positionOptions}
            value={positionKey}
            onChange={(key) => setPositionKey(key ?? LAST_KEY)}
          />
        </div>
      </GridBox>
    </DialogModal>
  )
}

/**
 * ページの削除。子孫があれば件数を示して確認し、配下ごと消す。
 * 戻り値の関数は、消した後に移る先(親かスペースのトップ)を受け取る
 */
export const useDeleteWikiPage = () => {
  const { t } = useLocale()
  const router = useRouter()
  const confirmAction = useConfirmAction()
  const { tree, reloadSpace } = useWikiSpace()

  return async (page: { id: string; title: string }, afterHref: string) => {
    const descendants = descendantIds(indexWikiTree(tree), page.id).length
    await confirmAction(
      {
        title: t('confirm_deletion'),
        text:
          descendants > 0
            ? t('msg_confirm_delete_wiki_page_with_children', { target: page.title, count: descendants })
            : t('msg_confirm_deletion', { target: page.title }),
      },
      async () => {
        const { deleted } = await parseAction(deleteWikiPage({ id: page.id, recursive: descendants > 0 }))
        notify.success(t('msg_deleted_wiki_pages', { target: page.title, count: deleted }))
        router.push(afterHref)
        await reloadSpace()
      },
    )
  }
}
