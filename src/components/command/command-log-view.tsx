'use client'

import { Panel } from '@/components/general/panel'
import { type CommandStream } from '@/generated/prisma/enums'
import { decodeSystemMessage } from '@/lib/command/command-log-message'
import { useLocale } from '@/locale/client'
import { Chip, cn } from '@heroui/react'
import { FC, useEffect, useRef, useState } from 'react'
import { tv } from 'tailwind-variants'

export type CommandLogLine = { seq: number; stream: CommandStream; text: string }

const lineStyles = tv({
  base: 'font-mono text-xs wrap-break-word whitespace-pre-wrap',
  variants: {
    stream: {
      stdout: '',
      stderr: 'text-danger',
      system: 'text-foreground-500 italic',
    },
  },
})

/**
 * 実行ログの表示。
 *
 * 末尾へ自動追従するが、利用者が自分でスクロールしたら止める。追いかけている最中に
 * 過去のログを読もうとすると引き戻されてしまうため。
 * 判定はチケットのコメント欄(`useCommentAnchor`)と同じ考え方で、
 * ホイール / タッチ / キー操作を「読みに来た」合図として扱う。
 */
export const CommandLogView: FC<{ lines: CommandLogLine[]; isLive: boolean }> = ({ lines, isLive }) => {
  const { t } = useLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const stopFollowing = () => setFollowing(false)
    container.addEventListener('wheel', stopFollowing, { passive: true })
    container.addEventListener('touchstart', stopFollowing, { passive: true })
    container.addEventListener('keydown', stopFollowing)
    return () => {
      container.removeEventListener('wheel', stopFollowing)
      container.removeEventListener('touchstart', stopFollowing)
      container.removeEventListener('keydown', stopFollowing)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !following) {
      return
    }
    container.scrollTop = container.scrollHeight
  }, [lines, following])

  return (
    <div className='relative'>
      <Panel className='px-2 py-1'>
        <div
          ref={containerRef}
          tabIndex={0}
          className='max-h-[32rem] overflow-y-auto'
          aria-label={t('command_run_log')}
        >
          {lines.map((line) => {
            // システム行はロケールキーで保存されている。この仕組みより前の行は平文なのでそのまま出す
            const message = line.stream === 'system' ? decodeSystemMessage(line.text) : null
            const text = message ? t(message.item, message.values) : line.text
            return (
              <div key={line.seq} className={lineStyles({ stream: line.stream })}>
                {text.replace(/\n$/, '')}
              </div>
            )
          })}
        </div>
      </Panel>
      {isLive && !following && (
        <button type='button' className='absolute right-3 bottom-2' onClick={() => setFollowing(true)}>
          <Chip color='accent' variant='soft' className={cn('cursor-pointer')}>
            {t('command_follow_latest')}
          </Chip>
        </button>
      )}
    </div>
  )
}
