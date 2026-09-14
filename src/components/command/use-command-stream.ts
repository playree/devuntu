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
 * 購読の状態。
 *
 * どの実行のものかを一緒に持つ。同じインスタンスへ別の実行が渡ったとき
 * (履歴から別の詳細へ遷移した場合など)に、前の実行のログを残さないため。
 */
type StreamState = {
  runId: string
  lines: CommandLogLine[]
  ended?: CommandStreamEnd
  /** 再接続中かどうか。表示を消さずに「つなぎ直している」とだけ伝える */
  reconnecting: boolean
}

const emptyState = (runId: string): StreamState => ({ runId, lines: [], reconnecting: false })

/** 再接続の境界で同じ seq が二重に届いても増やさない */
const appendLine = (lines: CommandLogLine[], line: CommandLogLine): CommandLogLine[] => {
  if (lines.length === 0 || lines[lines.length - 1].seq < line.seq) {
    return [...lines, line]
  }
  if (lines.some((existing) => existing.seq === line.seq)) {
    return lines
  }
  return [...lines, line].sort((a, b) => a.seq - b.seq)
}

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
  const [state, setState] = useState<StreamState>(() => emptyState(runId))
  /** 受け取った最大 seq と、それがどの実行のものか。リロード後の再開位置に使う */
  const cursorRef = useRef({ runId, seq: 0 })

  // 別の実行が渡った直後は、その実行のログが届くまで空として扱う
  const current = state.runId === runId ? state : emptyState(runId)

  useEffect(() => {
    if (!enabled) {
      return
    }

    // 前の実行のカーソルを送ると、新しい実行の先頭のログが飛ばされる
    if (cursorRef.current.runId !== runId) {
      cursorRef.current = { runId, seq: 0 }
    }

    /** 前の実行の状態へ書き足さないよう、必ず runId を確かめてから更新する */
    const update = (apply: (prev: StreamState) => StreamState) =>
      setState((prev) => apply(prev.runId === runId ? prev : emptyState(runId)))

    const source = new EventSource(`/api/command/runs/${runId}/stream?cursor=${cursorRef.current.seq}`)

    source.addEventListener('log', (event) => {
      const seq = Number((event as MessageEvent).lastEventId)
      if (!Number.isSafeInteger(seq)) {
        return
      }
      const payload = JSON.parse((event as MessageEvent).data as string) as LogEvent
      cursorRef.current = { runId, seq: Math.max(cursorRef.current.seq, seq) }
      update((prev) => ({ ...prev, lines: appendLine(prev.lines, { seq, ...payload }), reconnecting: false }))
    })

    source.addEventListener('end', (event) => {
      const ended = JSON.parse((event as MessageEvent).data as string) as CommandStreamEnd
      update((prev) => ({ ...prev, ended, reconnecting: false }))
      // 閉じないと EventSource が終わったストリームへ再接続し続ける
      source.close()
    })

    const setReconnecting = (reconnecting: boolean) => update((prev) => ({ ...prev, reconnecting }))

    // 接続時間の上限。自動再接続に任せるので、ここでは何もしない
    source.addEventListener('reconnect', () => setReconnecting(true))

    source.addEventListener('open', () => setReconnecting(false))
    source.addEventListener('error', () => setReconnecting(true))

    return () => source.close()
  }, [runId, enabled])

  return { lines: current.lines, ended: current.ended, reconnecting: current.reconnecting }
}
