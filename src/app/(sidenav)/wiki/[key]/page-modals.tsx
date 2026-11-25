'use client'

import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { usePushIfLeavable } from '@/components/general/leave-guard'
import { DialogModal, FormModal, type ModalBaseProps } from '@/components/general/modal'
import { SingleSelectCtrl, SingleSelectField } from '@/components/general/select'
import { DocumentPlusIcon, FolderArrowRightIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { useWikiPageTypeOptions } from '@/components/wiki-chip'
import { parseAction, useActionData } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { useUserTimezone } from '@/lib/auth/use-timezone'
import { ClientError } from '@/lib/error'
import { isSameOrder } from '@/lib/list-compare'
import { type CreateWikiPage, scCreateWikiPage } from '@/lib/schema/schema-wiki'
import { useConfirmAction } from '@/lib/use-confirm-action'
import {
  canChooseWikiPageType,
  defaultWikiPageType,
  MAX_WIKI_DEPTH,
  WIKI_TREE_CHANGED,
  wikiPagePath,
  wikiSpaceTypeSpec,
} from '@/lib/wiki/wiki-rule'
import { applyWikiTemplatePlaceholders } from '@/lib/wiki/wiki-template-rule'
import {
  depthOf,
  descendantIds,
  indexWikiTree,
  isSelfOrDescendant,
  placeInSiblings,
  subtreeHeight,
} from '@/lib/wiki/wiki-tree'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createWikiPage, deleteWikiPage, getWikiTemplateOptions, moveWikiPage } from './server'
import { useWikiSpace } from './space-context'

/** 作成後に本文の編集から始めるため、ページ詳細へ付けるクエリ */
export const EDIT_QUERY = 'edit'

/**
 * ページの作成。タイトルと種類を入れて作り、作ったページへ移って本文の編集を始める。
 * テンプレートを選ぶと、タイトル(プレースホルダーを置き換えたもの。空のテンプレートなら入力のまま)と種類を埋め、
 * 本文はサーバーがテンプレートから作る。種類はテンプレートのもので固定する
 */
export const CreatePageModal: FC<ModalBaseProps & { parent: { id: string; title: string } | null }> = ({
  state,
  reload,
  parent,
}) => {
  const { t, fet } = useLocale()
  const { space, access } = useWikiSpace()
  const pushIfLeavable = usePushIfLeavable()
  const typeOptions = useWikiPageTypeOptions()
  const { data: session } = authClient.useSession()
  const timezone = useUserTimezone()
  // 開いたときだけ引く(閉じている間もマウントされ、書けない人の画面にも置かれる)
  const { data: templates } = useActionData(() => getWikiTemplateOptions({ id: space.id }), {
    skip: !state.isOpen || !access.canWrite,
    key: space.id,
  })
  const templateOptions = Object.fromEntries((templates ?? []).map((template) => [template.id, template.name]))

  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<CreateWikiPage>({
    resolver: zodResolver(scCreateWikiPage),
    mode: 'onChange',
    defaultValues: {
      spaceId: space.id,
      parentId: parent?.id ?? null,
      title: '',
      type: defaultWikiPageType(space.type),
    },
  })
  const templateId = useWatch({ control, name: 'templateId' })

  const applyTemplate = (id: string | null) => {
    const template = templates?.find((row) => row.id === id)
    setValue('templateId', template?.id)
    if (!template) {
      return
    }
    setValue('type', template.type)
    if (template.title) {
      const title = applyWikiTemplatePlaceholders(template.title, {
        now: new Date(),
        timezone,
        userName: session?.user.name ?? '',
      })
      setValue('title', title, { shouldValidate: true })
    }
  }

  return (
    <FormModal
      state={state}
      onSubmit={handleSubmit(async (req) => {
        try {
          const res = await parseAction(createWikiPage(req))
          notify.success(t('msg_added_target', { target: req.title }))
          reload()
          state.close()
          // 編集中のページから子ページを作ったときは、下書きを捨てて移るかを確かめる(断ればページだけ作られる)
          await pushIfLeavable(`${wikiPagePath({ key: space.key, number: res.number })}?${EDIT_QUERY}=1`)
        } catch (e) {
          // 深さの上限などは parseAction が通知済み。入力し直してもらうため画面はそのまま残す
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
      title={{
        text: parent
          ? t('wiki_add_child_page')
          : wikiSpaceTypeSpec(space.type).announce
            ? t('wiki_new_announcement')
            : t('wiki_add_page'),
        icon: <DocumentPlusIcon />,
      }}
      submit={{ isPending: isSubmitting }}
    >
      <GridBox>
        {parent && (
          <p className='text-muted col-span-12 truncate text-sm'>{t('wiki_parent_page', { title: parent.title })}</p>
        )}
        {templates && templates.length > 0 && (
          <div className='col-span-12'>
            <SingleSelectField
              groupOptions={templateOptions}
              label={t('ticket_template')}
              placeholder={t('ticket_template')}
              value={templateId ?? null}
              onChange={applyTemplate}
              isClearable
            />
          </div>
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
        {canChooseWikiPageType(space.type) && ( // 種類が 1 つしか無い区分では選ばせない
          <div className='col-span-12'>
            <SingleSelectCtrl
              control={control}
              name='type'
              groupOptions={typeOptions}
              label={t('wiki_page_type')}
              isDisabled={!!templateId}
            />
          </div>
        )}
        {templateId && <p className='text-muted col-span-12 text-xs'>{t('msg_wiki_page_from_template')}</p>}
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

  // 選んだ「◯◯ の後」が再読み込みで兄弟から消えていたら、先頭ではなく末尾として扱う(選択肢にも末尾と出す)
  const selectedKey = positionKey in positionOptions ? positionKey : LAST_KEY
  const afterIndex = siblings.findIndex((item) => item.id === selectedKey)
  const position = selectedKey === FIRST_KEY ? 0 : afterIndex < 0 ? undefined : afterIndex + 1
  // サーバーへは番号ではなく基準の兄弟を送る。開いた後に兄弟が増減しても、選んだページの直後に入る
  const afterId = selectedKey === FIRST_KEY ? null : afterIndex < 0 ? undefined : selectedKey
  // サーバーと同じく、並べた結果の id の列で比べる(末尾のページで「末尾」を選んだときなども変化なしになる)
  const isUnchanged =
    parentId === currentParentId && isSameOrder(placeInSiblings(currentIds, page.id, position), currentIds)

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
