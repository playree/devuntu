'use client'

import { type CommandRunStatus, type CommandStream } from '@/generated/prisma/enums'
import { useEffect, useRef, useState } from 'react'
import { type CommandLogLine } from './command-log-view'

export type CommandStreamEnd = {
  status: CommandRunStatus | 'gone'
  exitCode?: number | null
  failureKind?: string | null
  truncated?: boolean
  lastSeq?: number
}

type LogEvent = { stream: CommandStream; text: string }

/**
 * 実行ログのライブ購読。
 *
 * `EventSource` は切断されると自動で再接続し、そのとき最後に受け取った `id:`(= seq)を
 * `Last-Event-ID` ヘッダで送り返す。サーバーはそれをカーソルとして続きから流すので、
 * 再接続の面倒はここで見なくてよい。
 *
 * 一方でリロード直後はヘッダが付かないため、初回だけ `?cursor=` で位置を渡す。
 *
 * @param runId 対象の実行
 * @param enabled 終了済みの実行を開き直したときなど、購読が要らない場合に false
 */
export const useCommandStream = (runId: string, enabled: boolean) => {
  const [lines, setLines] = useState<CommandLogLine[]>([])
  const [ended, setEnded] = useState<CommandStreamEnd>()
  /** 再接続中かどうか。表示を消さずに「つなぎ直している」とだけ伝える */
  const [reconnecting, setReconnecting] = useState(false)
  /** 受け取った最大 seq。リロード後の再開位置に使う */
  const cursorRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    const source = new EventSource(`/api/command/runs/${runId}/stream?cursor=${cursorRef.current}`)

    source.addEventListener('log', (event) => {
      const seq = Number((event as MessageEvent).lastEventId)
      if (!Number.isSafeInteger(seq)) {
        return
      }
      const payload = JSON.parse((event as MessageEvent).data as string) as LogEvent
      cursorRef.current = Math.max(cursorRef.current, seq)
      setReconnecting(false)
      setLines((prev) => {
        // 再接続の境界で同じ seq が二重に届いても増やさない
        if (prev.length > 0 && prev[prev.length - 1].seq >= seq) {
          return prev.some((line) => line.seq === seq)
            ? prev
            : [...prev, { seq, ...payload }].sort((a, b) => a.seq - b.seq)
        }
        return [...prev, { seq, ...payload }]
      })
    })

    source.addEventListener('end', (event) => {
      setEnded(JSON.parse((event as MessageEvent).data as string) as CommandStreamEnd)
      setReconnecting(false)
      // 閉じないと EventSource が終わったストリームへ再接続し続ける
      source.close()
    })

    // 接続時間の上限。自動再接続に任せるので、ここでは何もしない
    source.addEventListener('reconnect', () => setReconnecting(true))

    source.addEventListener('open', () => setReconnecting(false))
    source.addEventListener('error', () => setReconnecting(true))

    return () => source.close()
  }, [runId, enabled])

  return { lines, ended, reconnecting }
}
