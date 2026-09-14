/**
 * SSE ストリームの単体テスト
 *
 * 依存を注入できるようにしてあるので、DB も時計も無しでフレームの中身を固定できる。
 * 固定したいのは「カーソルの進み方」と「終端で必ず閉じること」。
 * 閉じ損ねるとクライアントの `EventSource` が終わったストリームへ再接続し続ける。
 */

import { COMMAND_SSE_MAX_MS, COMMAND_SSE_RETRY_MS } from '@/lib/command/command'
import { buildLogStream, type LogStreamDeps, type RunState } from '@/lib/command/command-stream'
import { describe, expect, it, vi } from 'vitest'

const state = (overrides: Partial<RunState> = {}): RunState => ({
  status: 'running',
  exitCode: null,
  failureKind: null,
  truncated: false,
  lastSeq: 0,
  ...overrides,
})

/** ストリームを最後まで読み切って本文を返す */
const readAll = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    text += decoder.decode(value)
  }
  return text
}

const makeDeps = (overrides: Partial<LogStreamDeps> = {}): LogStreamDeps => ({
  readChunks: async () => [],
  readState: async () => state({ status: 'succeeded' }),
  wait: async () => {},
  now: () => 0,
  ...overrides,
})

describe('buildLogStream', () => {
  it('接続直後に retry とコメントを流す', async () => {
    // Next はヘッダを最初のチャンク書き込み時に flush するので、
    // 1バイトも流さないと EventSource の onopen が発火しない
    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, makeDeps()))
    expect(body.startsWith(`retry: ${COMMAND_SSE_RETRY_MS}\n\n: open\n\n`)).toBe(true)
  })

  it('ログを id 付きで流し、終端で end を出して閉じる', async () => {
    let served = false
    const deps = makeDeps({
      readChunks: async () => {
        if (served) {
          return []
        }
        served = true
        return [
          { seq: 1, stream: 'stdout', text: 'a\n' },
          { seq: 2, stream: 'stderr', text: 'b\n' },
        ]
      },
      readState: async () => state({ status: 'succeeded', exitCode: 0, lastSeq: 2 }),
    })

    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, deps))

    // id はクライアントが Last-Event-ID として送り返す再開位置になる
    expect(body).toContain('id: 1\nevent: log\ndata: {"stream":"stdout","text":"a\\n"}\n\n')
    expect(body).toContain('id: 2\nevent: log\ndata: {"stream":"stderr","text":"b\\n"}\n\n')
    expect(body).toContain('event: end\n')
  })

  it('本文は改行を含まない1行の JSON にする', async () => {
    // data: は改行を含められないので、生テキストを載せるとフレームが壊れる
    let served = false
    const deps = makeDeps({
      readChunks: async () => {
        if (served) {
          return []
        }
        served = true
        return [{ seq: 1, stream: 'stdout', text: 'line1\nline2\n' }]
      },
      readState: async () => state({ status: 'succeeded', lastSeq: 1 }),
    })

    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, deps))
    const dataLines = body.split('\n').filter((line) => line.startsWith('data: '))
    dataLines.forEach((line) => expect(line).not.toContain('\n'))
    expect(body).toContain('data: {"stream":"stdout","text":"line1\\nline2\\n"}')
  })

  it('カーソルより後ろだけを要求する', async () => {
    const readChunks: LogStreamDeps['readChunks'] = vi.fn(async () => [])
    await readAll(buildLogStream('run-1', 7, new AbortController().signal, makeDeps({ readChunks })))
    expect(vi.mocked(readChunks).mock.calls[0][1]).toBe(7)
  })

  it('未取得のチャンクが残っていれば終端でも閉じない', async () => {
    // lastSeq に追いつく前に閉じると、最後の数行が永久に届かない
    let calls = 0
    const deps = makeDeps({
      readChunks: async () => {
        calls += 1
        if (calls === 1) {
          return []
        }
        if (calls === 2) {
          return [{ seq: 5, stream: 'stdout' as const, text: 'last\n' }]
        }
        return []
      },
      readState: async () => state({ status: 'succeeded', lastSeq: 5 }),
    })

    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, deps))
    expect(body).toContain('id: 5\n')
    expect(body).toContain('event: end\n')
  })

  it('実行が消えていたら gone を返して閉じる', async () => {
    // 履歴の掃除と競合した場合。開いたままにしない
    const deps = makeDeps({ readState: async () => null })
    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, deps))
    expect(body).toContain('event: end\ndata: {"status":"gone"}')
  })

  it('接続時間の上限で reconnect を出して閉じる', async () => {
    let now = 0
    const deps = makeDeps({
      readState: async () => state({ status: 'running', lastSeq: 0 }),
      wait: async () => {
        now += COMMAND_SSE_MAX_MS + 1
      },
      now: () => now,
    })

    const body = await readAll(buildLogStream('run-1', 3, new AbortController().signal, deps))
    // end ではなく閉じるだけにして、自動再接続に続きを任せる
    expect(body).toContain('event: reconnect\ndata: {"cursor":3}')
    expect(body).not.toContain('event: end')
  })

  it('切断されたら閉じる', async () => {
    const controller = new AbortController()
    const deps = makeDeps({
      readState: async () => state({ status: 'running' }),
      wait: async () => controller.abort(),
    })

    const body = await readAll(buildLogStream('run-1', 0, controller.signal, deps))
    expect(body).not.toContain('event: end')
  })

  it('無音が続けばハートビートを流す', async () => {
    let now = 0
    let ticks = 0
    const deps = makeDeps({
      readState: async () => state({ status: ticks > 2 ? 'succeeded' : 'running', lastSeq: 0 }),
      wait: async () => {
        ticks += 1
        now += 20_000
      },
      now: () => now,
    })

    const body = await readAll(buildLogStream('run-1', 0, new AbortController().signal, deps))
    expect(body).toContain(': hb\n\n')
  })
})

describe('pull は必ず何かを流すか閉じる', () => {
  /**
   * enqueue せずに `pull` を抜けると配信が止まる。
   *
   * Streams の仕様では `pull` の再呼び出しは「実行中に新しい read 要求が来た」か
   * 「desiredSize > 0」のときだけで、消費側の read 要求は充足されないまま1つ残るだけ。
   * そのため未読が無い間は `pull` の中で待ち続ける必要がある。
   */
  it('未読が無い間は pull の中で待ち、データが出たら同じ read で届ける', async () => {
    let calls = 0
    const deps = makeDeps({
      readChunks: async () => {
        calls += 1
        return calls >= 4 ? [{ seq: 1, stream: 'stdout' as const, text: 'late\n' }] : []
      },
      readState: async () => state({ status: 'running', lastSeq: 1 }),
    })

    const reader = buildLogStream('run-1', 0, new AbortController().signal, deps).getReader()
    const decoder = new TextDecoder()
    await reader.read() // retry
    await reader.read() // : open

    // 空振りが続いても、この1回の read でログが返ってくる
    const third = await reader.read()
    expect(decoder.decode(third.value)).toContain('late')
    expect(calls).toBeGreaterThanOrEqual(4)
    await reader.cancel()
  })

  it('ハートビートも1回の read で返す', async () => {
    let now = 0
    const deps = makeDeps({
      readState: async () => state({ status: 'running', lastSeq: 0 }),
      wait: async () => {
        now += 5_000
      },
      now: () => now,
    })

    const reader = buildLogStream('run-1', 0, new AbortController().signal, deps).getReader()
    const decoder = new TextDecoder()
    await reader.read()
    await reader.read()

    const third = await reader.read()
    expect(decoder.decode(third.value)).toBe(': hb\n\n')
    await reader.cancel()
  })
})
