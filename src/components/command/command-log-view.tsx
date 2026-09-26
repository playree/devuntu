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
      system: 'text-muted italic',
    },
  },
})

/**
 * md 以上は親(data-fit-screen)の残り高さを埋めてログ枠を画面下端まで伸ばす。
 * md 未満はページ全体のスクロールに任せるので、従来どおり最大高で頭打ちにする。
 * min-h-0 は、flex 子の最小高が内容高に張り付いて枠が縮まず溢れるのを防ぐため
 */
const frameStyles = tv({
  slots: {
    root: 'relative md:flex md:min-h-0 md:flex-1 md:flex-col',
    panel: 'px-2 py-1 md:flex md:min-h-0 md:flex-1 md:flex-col',
    scroller: 'max-h-[32rem] overflow-y-auto md:max-h-none md:min-h-0 md:flex-1',
  },
})
const frame = frameStyles()

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
    <div className={frame.root()}>
      <Panel className={frame.panel()}>
        <div ref={containerRef} tabIndex={0} className={frame.scroller()} aria-label={t('command_run_log')}>
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
