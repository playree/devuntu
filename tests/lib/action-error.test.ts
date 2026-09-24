/** errorType から通知文言を引く対応表。文言キーが両ロケールに存在することも確かめる */

import {
  ACTION_ERROR_MESSAGES,
  DEFAULT_ACTION_ERROR_MESSAGE,
  isReAuthRequired,
  resolveActionErrorMessage,
} from '@/lib/action/action-error'
import { SESSION_NOT_FRESH } from '@/lib/auth/auth-config'
import { DUPLICATED_BOARD_KEY, DUPLICATED_TAG_NAME } from '@/lib/board/task'
import { COMMAND_ALREADY_RUNNING } from '@/lib/command/command'
import { INVALID_OPERATION, SYSTEM_ERROR, TOO_MANY_REQUESTS } from '@/lib/error'
import { en } from '@/locale/lang-en'
import { ja } from '@/locale/lang-ja'
import { describe, expect, it } from 'vitest'

describe('resolveActionErrorMessage', () => {
  it('利用者が直せる/待てば通るものは warn', () => {
    expect(resolveActionErrorMessage(DUPLICATED_TAG_NAME)).toEqual({ item: 'msg_duplicated_tag_name', level: 'warn' })
    expect(resolveActionErrorMessage(DUPLICATED_BOARD_KEY).level).toBe('warn')
    expect(resolveActionErrorMessage(TOO_MANY_REQUESTS).level).toBe('warn')
    expect(resolveActionErrorMessage(COMMAND_ALREADY_RUNNING).level).toBe('warn')
  })

  it('想定外の失敗は error', () => {
    expect(resolveActionErrorMessage(INVALID_OPERATION)).toEqual({ item: 'msg_invalid_operation', level: 'error' })
  })

  it('対応表に無い errorType は既定の文言', () => {
    expect(resolveActionErrorMessage(SYSTEM_ERROR)).toBe(DEFAULT_ACTION_ERROR_MESSAGE)
    expect(resolveActionErrorMessage('UNKNOWN_CODE')).toBe(DEFAULT_ACTION_ERROR_MESSAGE)
  })

  it('文言キーは ja / en の両方にある', () => {
    for (const { item } of [...Object.values(ACTION_ERROR_MESSAGES), DEFAULT_ACTION_ERROR_MESSAGE]) {
      expect(ja[item], item).toBeTruthy()
      expect(en[item], item).toBeTruthy()
    }
  })
})

describe('isReAuthRequired', () => {
  it('SESSION_NOT_FRESH だけが再認証の対象', () => {
    expect(isReAuthRequired(SESSION_NOT_FRESH)).toBe(true)
    expect(isReAuthRequired(TOO_MANY_REQUESTS)).toBe(false)
  })
})
