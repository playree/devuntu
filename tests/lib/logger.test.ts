/**
 * ログの秘匿設定
 *
 * Server Action の input は `{ metadata, input }` の入れ子でログに出るため、
 * 最上位以外のキーも伏せられることを確認する。
 */

import { LOG_REDACT_PATHS } from '@/lib/logger'
import { Writable } from 'node:stream'
import pino from 'pino'
import { describe, expect, it } from 'vitest'

const capture = (obj: object) => {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString())
      cb()
    },
  })
  pino({ redact: LOG_REDACT_PATHS }, stream).info(obj, 'test')
  return JSON.parse(lines[0])
}

describe('LOG_REDACT_PATHS', () => {
  it('最上位のキーを伏せる', () => {
    expect(capture({ password: 'secret' }).password).toBe('[Redacted]')
  })

  it('Server Action の input に含まれるキーを伏せる', () => {
    const log = capture({ metadata: { actionName: 'x' }, input: { email: 'a', password: 'secret', token: 't' } })
    expect(log.input).toEqual({ email: 'a', password: '[Redacted]', token: '[Redacted]' })
  })

  it('2階層下のキーも伏せる', () => {
    expect(capture({ res: { body: { client_secret: 's' } } }).res.body.client_secret).toBe('[Redacted]')
  })
})
