/**
 * Server Action のエラー(errorType)を画面の通知文言へ対応づける。
 *
 * NOTE: クライアントからも import されるため、prisma を持ち込むモジュールを参照しないこと。
 */
import type { LocaleItemBase } from '@/locale'
import { DUPLICATED_AGENT_HANDLE } from '../agent/agent'
import { SESSION_NOT_FRESH } from '../auth/auth-config'
import { DUPLICATED_BOARD_KEY, DUPLICATED_TAG_NAME } from '../board/task'
import {
  COMMAND_ALREADY_RUNNING,
  COMMAND_DEF_CONFLICT,
  COMMAND_DEF_NOT_EDITABLE,
  COMMAND_DEF_READ_ONLY,
  COMMAND_QUEUE_FULL,
} from '../command/command'
import {
  CANNOT_DELETE_LAST_ADMIN,
  COMMUNICATION_ERROR,
  CONSENT_INVALID,
  INVALID_OPERATION,
  INVALID_SESSION,
  NOT_FOUND,
  PERMISSION_DENIED,
  TOO_MANY_REQUESTS,
  VALIDATION_ERROR,
} from '../error'
import { DUPLICATED_MCP_TOKEN_NAME } from '../mcp/mcp'

export type ActionErrorMessage = {
  item: LocaleItemBase
  /** warn: 利用者が直せる・待てば通る / error: 想定外の失敗 */
  level: 'warn' | 'error'
}

/** 対応表に無い errorType(SYSTEM_ERROR・better-auth のコードなど)に使う */
export const DEFAULT_ACTION_ERROR_MESSAGE: ActionErrorMessage = { item: 'msg_system_error', level: 'error' }

export const ACTION_ERROR_MESSAGES: Record<string, ActionErrorMessage> = {
  [TOO_MANY_REQUESTS]: { item: 'msg_too_many_requests', level: 'warn' },
  [INVALID_SESSION]: { item: 'msg_invalid_session', level: 'error' },
  [PERMISSION_DENIED]: { item: 'msg_no_access', level: 'error' },
  [NOT_FOUND]: { item: 'not_found', level: 'error' },
  [INVALID_OPERATION]: { item: 'msg_invalid_operation', level: 'error' },
  [VALIDATION_ERROR]: { item: 'msg_validation_error', level: 'error' },
  [COMMUNICATION_ERROR]: { item: 'msg_communication_error', level: 'error' },
  [CONSENT_INVALID]: { item: 'msg_consent_invalid', level: 'warn' },
  [CANNOT_DELETE_LAST_ADMIN]: { item: 'msg_cannot_delete_last_admin', level: 'warn' },
  [DUPLICATED_BOARD_KEY]: { item: 'msg_duplicated_board_key', level: 'warn' },
  [DUPLICATED_TAG_NAME]: { item: 'msg_duplicated_tag_name', level: 'warn' },
  [DUPLICATED_AGENT_HANDLE]: { item: 'msg_duplicated_agent_handle', level: 'warn' },
  [DUPLICATED_MCP_TOKEN_NAME]: { item: 'msg_duplicated_token_name', level: 'warn' },
  [COMMAND_ALREADY_RUNNING]: { item: 'msg_command_already_running', level: 'warn' },
  [COMMAND_QUEUE_FULL]: { item: 'msg_command_queue_full', level: 'warn' },
  [COMMAND_DEF_CONFLICT]: { item: 'command_def_conflict', level: 'warn' },
  [COMMAND_DEF_NOT_EDITABLE]: { item: 'command_def_not_editable', level: 'warn' },
  [COMMAND_DEF_READ_ONLY]: { item: 'command_def_read_only', level: 'warn' },
}

export const resolveActionErrorMessage = (errorType: string): ActionErrorMessage =>
  ACTION_ERROR_MESSAGES[errorType] ?? DEFAULT_ACTION_ERROR_MESSAGE

/** 通知ではなく再認証へ誘導する errorType */
export const isReAuthRequired = (errorType: string) => errorType === SESSION_NOT_FRESH
