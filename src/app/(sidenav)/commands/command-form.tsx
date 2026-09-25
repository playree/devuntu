'use client'

import { MultiButton } from '@/components/general/button'
import { CheckboxCtrl } from '@/components/general/checkbox'
import { GridBox } from '@/components/general/grid'
import { InputCtrl } from '@/components/general/input'
import { FormModal, ModalBaseProps, useConfirmModal } from '@/components/general/modal'
import { RadioCtrl } from '@/components/general/radio'
import { MultiSelectCtrl, SingleSelectCtrl } from '@/components/general/select'
import { CommandLineIcon } from '@/components/icon'
import { parseAction } from '@/lib/action/action-client'
import { type CommandInput, type CommandInputValues } from '@/lib/command/command'
import { buildCommandInputSchema } from '@/lib/command/command-args'
import { ClientError } from '@/lib/error'
import { useLocale } from '@/locale/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { FC, useMemo } from 'react'
import { Control, type Resolver, useForm } from 'react-hook-form'
import { type AvailableCommandView, startCommandRunAction } from './server'

/** 入力の種別ごとの描画。種別が増えたらここがコンパイルエラーになる */
const InputControl: FC<{ input: CommandInput; control: Control<CommandInputValues>; errorMessage?: string }> = ({
  input,
  control,
  errorMessage,
}) => {
  const options = 'options' in input ? Object.fromEntries(input.options.map((o) => [o.value, o.label])) : {}

  switch (input.type) {
    case 'select':
      return (
        <SingleSelectCtrl
          control={control}
          name={input.key}
          groupOptions={options}
          label={input.label}
          isRequired={input.required}
          errorMessage={errorMessage}
        />
      )
    case 'radio':
      return (
        <RadioCtrl
          control={control}
          name={input.key}
          options={input.options}
          label={input.label}
          isRequired={input.required}
          errorMessage={errorMessage}
        />
      )
    case 'multiselect':
      return (
        <MultiSelectCtrl
          control={control}
          name={input.key}
          groupOptions={options}
          label={input.label}
          errorMessage={errorMessage}
        />
      )
    case 'checkbox':
      return <CheckboxCtrl control={control} name={input.key} id={`command-input-${input.key}`} label={input.label} />
    case 'input':
      return (
        <InputCtrl
          control={control}
          name={input.key}
          label={input.label}
          isRequired={input.required}
          maxLength={input.maxLength}
          placeholder={input.placeholder}
          errorMessage={errorMessage}
        />
      )
  }
}

/**
 * コマンドの実行フォーム。
 *
 * 入力項目は定義から組み立てる。検証スキーマも定義から作るが、**サーバー側の再検証と同じ関数**
 * (`buildCommandInputSchema` / `resolveCommandArgs`)を使う。別々に書くと片方だけが緩くなる。
 */
export const CommandForm: FC<ModalBaseProps & { target: AvailableCommandView }> = ({ state, reload, target }) => {
  const { t, fet } = useLocale()
  const router = useRouter()
  const { confirmModal } = useConfirmModal()

  // 定義が変わらない限り作り直さない
  /**
   * 定義から作る検証スキーマ。
   *
   * 形が定義ごとに変わるため zod の推論では `CommandInputValues` に絞れない。
   * ここで型を合わせるが、**実際に値を弾くのはサーバー側と同じ関数**
   * (`buildCommandInputSchema` / `resolveCommandArgs`)なので、
   * 画面側だけが緩くなることはない。
   */
  const schema = useMemo(() => buildCommandInputSchema({ ...target, inputs: target.inputs } as never), [target])

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<CommandInputValues>({
    // 形が定義ごとに変わるので、resolver の型引数は推論に任せられない
    resolver: zodResolver(schema) as Resolver<CommandInputValues>,
    mode: 'onChange',
    defaultValues: target.defaults,
  })

  return (
    <FormModal
      size='2xl'
      state={state}
      onSubmit={handleSubmit(async (params) => {
        if (target.requireConfirm) {
          const ok = await confirmModal().confirm({
            title: target.label,
            text: target.confirmText ?? t('msg_command_confirm'),
            requireCheck: true,
          })
          if (!ok) {
            return
          }
        }

        try {
          const run = await parseAction(startCommandRunAction({ commandKey: target.id, params }))
          state.close()
          reload()
          // 実行中の表示と履歴詳細は同じ画面。開始直後もそこへ送る
          router.push(`/commands/runs/${run.id}`)
        } catch (e) {
          // 実行中・順番待ちの上限・再認証などは parseAction が通知済み。同じ入力で再試行できるようモーダルは閉じない
          if (!(e instanceof ClientError)) {
            throw e
          }
        }
      })}
      title={{ text: target.label, icon: <CommandLineIcon /> }}
      footer={
        <>
          <MultiButton slot='close' variant='ghost'>
            {t('cancel')}
          </MultiButton>
          <MultiButton type='submit' icon={<CommandLineIcon />} isPending={isSubmitting}>
            {t('command_run')}
          </MultiButton>
        </>
      }
    >
      <GridBox>
        {target.description && <div className='text-foreground-500 col-span-12 text-xs'>{target.description}</div>}
        {target.inputs.length === 0 && <div className='col-span-12 text-sm'>{t('command_no_input')}</div>}
        {target.inputs.map((input) => (
          <div key={input.key} className='col-span-12'>
            <InputControl input={input} control={control} errorMessage={fet(errors[input.key])} />
          </div>
        ))}
      </GridBox>
    </FormModal>
  )
}
