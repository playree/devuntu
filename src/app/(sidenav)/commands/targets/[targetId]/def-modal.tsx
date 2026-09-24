'use client'

import { YamlInput } from '@/components/code/yaml-editor'
import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { FormModal, ModalBaseProps } from '@/components/general/modal'
import { NoticePanel } from '@/components/general/panel'
import { CheckIcon, PencilSquareIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { parseAction } from '@/lib/action/action-client'
import { COMMAND_DEF_CONFLICT, COMMAND_DEF_NOT_EDITABLE, COMMAND_DEF_READ_ONLY } from '@/lib/command/command'
import { formatCommandIssues, scCommandDefInput } from '@/lib/command/command-def'
import { lintCommandDefYaml } from '@/lib/command/command-def-lint'
import { ClientError } from '@/lib/error'
import { useLocale } from '@/locale/client'
import { FC, useState } from 'react'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { type CommandDefView, upsertCommandDefAction } from './server'

/** 追加のときに出す雛形。最低限の必須項目だけを置き、あとは書き足してもらう */
const templateOf = (label: string) =>
  ['id: my-command', `label: ${label}`, 'executable: /opt/bin/example.sh'].join('\n')

/** 編集の宛先。追加はターゲットだけ、更新は置き換える 1 件も持つ */
export type CommandDefTarget = {
  targetKey: string
  revision: string
  targetLabel: string
  /** ターゲットがフリー入力を許しているか。書いている最中の検証に渡す */
  allowFreeInput: boolean
  /** 更新するコマンド。追加なら null */
  command: CommandDefView | null
}

/**
 * コマンド定義の追加・編集。
 *
 * 編集の単位を**コマンド 1 件**にしてあるので、テキスト編集でも隣のコマンドを巻き込まない。
 * 送るのはパース済みのオブジェクトで、YAML の文字列はサーバーへ渡さない。
 * ファイルへの書き出しは書き戻し側(`command-writer.ts`)の一方向に閉じる。
 */
export const CommandDefModal: FC<ModalBaseProps & { target: CommandDefTarget }> = ({ state, reload, target }) => {
  const { t } = useLocale()
  const [text, setText] = useState(
    // 編集時は定義の現物を YAML へ起こす。`targetId` は YAML に書かない項目なのでサーバー側で落としてある
    target.command?.source
      ? stringifyYaml(target.command.source, { lineWidth: 0 })
      : templateOf(t('command_def_template_label')),
  )
  const [messages, setMessages] = useState<string[]>([])
  const [isSubmitting, setSubmitting] = useState(false)

  const replaceId = target.command?.id ?? null

  return (
    <FormModal
      state={state}
      size='3xl'
      onSubmit={async (e) => {
        e?.preventDefault()
        setMessages([])

        let raw: unknown
        try {
          raw = parseYaml(text)
        } catch (error) {
          setMessages([`${t('command_def_yaml_invalid')} ${error instanceof Error ? error.message : String(error)}`])
          return
        }

        // 画面でも定義ファイルと同じスキーマで見る。往復せずに直せる分をここで返す
        const parsed = scCommandDefInput.safeParse(raw)
        if (!parsed.success) {
          setMessages(formatCommandIssues(parsed.error))
          return
        }

        setSubmitting(true)
        try {
          const result = await parseAction(
            upsertCommandDefAction({
              targetKey: target.targetKey,
              revision: target.revision,
              replaceId,
              command: parsed.data,
            }),
            { handled: [COMMAND_DEF_CONFLICT, COMMAND_DEF_NOT_EDITABLE, COMMAND_DEF_READ_ONLY] },
          )
          if (!result?.ok) {
            setMessages(result?.messages ?? [])
            return
          }
          notify.success(t('msg_saved'))
          reload()
          state.close()
        } catch (e) {
          if (!(e instanceof ClientError)) {
            throw e
          }
          // 直せる余地がある状態はモーダルを開いたまま伝える。閉じると書いた内容が消える
          switch (e.errorType) {
            case COMMAND_DEF_CONFLICT:
              setMessages([t('command_def_conflict')])
              // 最新を読み直す。revision が変わるので、この画面はもう保存できない
              reload()
              return
            case COMMAND_DEF_NOT_EDITABLE:
              setMessages([t('command_def_not_editable')])
              return
            case COMMAND_DEF_READ_ONLY:
              setMessages([t('command_def_read_only')])
              return
            default:
              // レート制限・再認証などは parseAction が通知済み
              return
          }
        } finally {
          setSubmitting(false)
        }
      }}
      title={{ text: target.command ? t('command_def_edit') : t('command_def_add'), icon: <PencilSquareIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CheckIcon />} isPending={isSubmitting}>
            {t('ok')}
          </MultiButton>
        </>
      }
    >
      <FlexCol>
        <div className='text-foreground-500 text-xs'>{target.targetLabel}</div>
        <YamlInput
          defaultValue={text}
          onChange={setText}
          minRows={16}
          // 許可はターゲット側にあり、コマンド 1 件の YAML からは読めないので渡す
          lint={(value) => lintCommandDefYaml(value, { allowFreeInput: target.allowFreeInput })}
        />
        {messages.length > 0 && (
          <NoticePanel status='danger'>
            <ul className='list-inside list-disc text-xs'>
              {messages.map((message) => (
                <li key={message} className='break-all'>
                  {message}
                </li>
              ))}
            </ul>
          </NoticePanel>
        )}
      </FlexCol>
    </FormModal>
  )
}
