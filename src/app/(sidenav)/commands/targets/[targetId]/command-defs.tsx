'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol, FlexRow } from '@/components/general/flex'
import { NoticePanel, Panel } from '@/components/general/panel'
import { ContentHeader } from '@/components/header'
import { CommandLineIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@/components/icon'
import { type CommandInputType } from '@/lib/command/command'
import { type LocaleItem } from '@/locale'
import { useLocale } from '@/locale/client'
import { Chip } from '@heroui/react'
import { FC } from 'react'
import { type CommandDefView } from './server'

/** 入力種別 → ロケールキー。種別が増えたらここがコンパイルエラーになる */
const INPUT_TYPE_LABEL = {
  select: 'command_input_type_select',
  radio: 'command_input_type_radio',
  multiselect: 'command_input_type_multiselect',
  checkbox: 'command_input_type_checkbox',
  input: 'command_input_type_input',
} as const satisfies Record<CommandInputType, LocaleItem>

/**
 * ターゲットに属するコマンド定義の一覧。
 *
 * 定義ファイル由来の情報は読み取り専用で、編集できるのはターゲットのオーナーだけ
 * (かつ `target.editable: true` で、定義ディレクトリが書き込み可のとき)。
 */
export const CommandDefs: FC<{
  commands: CommandDefView[]
  canEdit: boolean
  /** 編集モーダルを開いてよいかを確かめている対象。追加ボタンなら commandId は null */
  checking?: { commandId: string | null } | null
  onAdd: () => void
  onEdit: (command: CommandDefView) => void
  onDelete: (command: CommandDefView) => void
}> = ({ commands, canEdit, checking, onAdd, onEdit, onDelete }) => {
  const { t } = useLocale()

  return (
    <FlexCol>
      <ContentHeader icon={<CommandLineIcon />} title={t('command_definition')}>
        {canEdit && (
          <MultiButton
            isIconOnly
            tooltip={t('command_def_add')}
            isPending={!!checking && checking.commandId === null}
            icon={<PlusIcon />}
            onPress={onAdd}
          />
        )}
      </ContentHeader>

      {commands.length === 0 ? (
        <NoticePanel>{t('command_no_def')}</NoticePanel>
      ) : (
        commands.map((command) => (
          <Panel key={command.id}>
            <FlexCol>
              <FlexRow className='flex-wrap items-center'>
                <span className='font-semibold'>{command.label}</span>
                <span className='text-muted font-mono text-xs'>{command.id}</span>
                <span className='grow' />
                {canEdit && (
                  <>
                    <MultiButton
                      isIconOnly
                      variant='outline'
                      tooltip={t('command_def_edit')}
                      isPending={checking?.commandId === command.id}
                      icon={<PencilSquareIcon />}
                      onPress={() => {
                        onEdit(command)
                      }}
                    />
                    <MultiButton
                      isIconOnly
                      variant='danger-soft'
                      tooltip={t('command_def_delete')}
                      icon={<TrashIcon />}
                      onPress={() => {
                        onDelete(command)
                      }}
                    />
                  </>
                )}
              </FlexRow>

              {command.description && <div className='text-muted text-xs'>{command.description}</div>}

              <div className='overflow-x-auto'>
                <pre className='font-mono text-xs whitespace-pre'>
                  {[command.executable, ...command.args].join(' ')}
                </pre>
              </div>

              {command.inputs.length > 0 && (
                <FlexRow className='flex-wrap items-center'>
                  <span className='text-muted text-xs'>{t('command_inputs')}</span>
                  {command.inputs.map((input) => (
                    <Chip key={input.key} variant='soft' className='whitespace-nowrap'>
                      {input.label} / {t(INPUT_TYPE_LABEL[input.type])}
                      {input.optionCount > 0 && ` (${input.optionCount})`}
                    </Chip>
                  ))}
                </FlexRow>
              )}

              <FlexRow className='text-muted flex-wrap items-center text-xs'>
                <span>
                  {t('command_timeout')}: {command.timeoutSec}s
                </span>
                {command.singleton && <span>{t('command_singleton')}</span>}
                {command.requireConfirm && <span>{t('command_confirm_required')}</span>}
                {command.requireFreshSession && <span>{t('command_fresh_session_required')}</span>}
                <span className='grow' />
                <span>
                  {t('sort_order')}: {command.sortOrder}
                </span>
              </FlexRow>
            </FlexCol>
          </Panel>
        ))
      )}
    </FlexCol>
  )
}
