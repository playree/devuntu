/** 返す errorType でクライアントが分岐するため、エラー種別ごとの返却内容を固定する */

import { handleServerError } from '@/lib/action/action-server'
import { ClientError, errNotFound } from '@/lib/error'
import { APIError } from 'better-auth'
import { describe, expect, it } from 'vitest'

describe('ClientError: 利用者向けの内容をそのまま返す', () => {
  it('errorType と message を保つ', () => {
    expect(handleServerError(errNotFound())).toEqual({
      name: 'ClientError',
      errorType: 'NOT_FOUND',
      message: 'Not Found',
    })
  })

  it('任意の errorType も潰さない', () => {
    expect(handleServerError(new ClientError('CUSTOM_TYPE', 'custom message'))).toEqual({
      name: 'ClientError',
      errorType: 'CUSTOM_TYPE',
      message: 'custom message',
    })
  })
})

describe('better-auth の APIError: 原因を追えるように body の内容を返す', () => {
  it('body の code と message を使う', () => {
    const error = new APIError('BAD_REQUEST', { code: 'SESSION_NOT_FRESH', message: 'session is not fresh' })
    expect(handleServerError(error)).toEqual({
      errorType: 'SESSION_NOT_FRESH',
      message: 'session is not fresh',
    })
  })

  it('code が無ければ AUTH_ERROR にフォールバックする', () => {
    const error = new APIError('UNAUTHORIZED', { message: 'unauthorized' })
    expect(handleServerError(error)).toEqual({
      errorType: 'AUTH_ERROR',
      message: 'unauthorized',
    })
  })

  it('body の message が無ければ Error.message を使う', () => {
    const error = new APIError('BAD_REQUEST', { code: 'USER_NOT_EXIST' })
    error.message = 'user not exist'
    expect(handleServerError(error)).toEqual({
      errorType: 'USER_NOT_EXIST',
      message: 'user not exist',
    })
  })
})

describe('システムエラー: 内部情報を出さない', () => {
  it('固定文言に潰す', () => {
    expect(handleServerError(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).toEqual({
      errorType: 'SYSTEM_ERROR',
      message: 'Internal Server Error',
    })
  })
})
