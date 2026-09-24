export class ClientError extends Error {
  static {
    this.prototype.name = 'ClientError'
  }
  errorType: string
  constructor(errorType: string, message?: string, options?: ErrorOptions) {
    super(message ?? errorType, options)
    this.errorType = errorType
  }
}
export const errClient = (errorType: string) => new ClientError(errorType)

/* クライアント側で errorType を見て分岐・通知文言を引くため、型名を定数で公開する */
export const INVALID_SESSION = 'INVALID_SESSION'
export const PERMISSION_DENIED = 'PERMISSION_DENIED'
export const NOT_FOUND = 'NOT_FOUND'
export const VALIDATION_ERROR = 'VALIDATION_ERROR'
export const COMMUNICATION_ERROR = 'COMMUNICATION_ERROR'
export const INVALID_OPERATION = 'INVALID_OPERATION'
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS'
/** 同意要求の署名不正・期限切れ */
export const CONSENT_INVALID = 'CONSENT_INVALID'
/** 最後の管理者の削除・降格 */
export const CANNOT_DELETE_LAST_ADMIN = 'CANNOT_DELETE_LAST_ADMIN'
/** ClientError 以外(サーバー内部の例外)。action-server の handleServerError が返す */
export const SYSTEM_ERROR = 'SYSTEM_ERROR'

export const errInvalidSession = () => new ClientError(INVALID_SESSION, 'Invalid Session')
export const errPermissionDenied = () => new ClientError(PERMISSION_DENIED, 'Permission denied')
export const errNotFound = () => new ClientError(NOT_FOUND, 'Not Found')
export const errValidation = (message: string) => new ClientError(VALIDATION_ERROR, `Validation Error: ${message}`)
export const errCommunication = (message: string) =>
  new ClientError(COMMUNICATION_ERROR, `Communication Error: ${message}`)
export const errInvalidOperation = () => new ClientError(INVALID_OPERATION, 'Invalid Operation')
export const errTooManyRequests = () => new ClientError(TOO_MANY_REQUESTS, 'Too Many Requests')
export const errConsentInvalid = () => new ClientError(CONSENT_INVALID, 'Invalid Consent Request')
export const errCannotDeleteLastAdmin = () => new ClientError(CANNOT_DELETE_LAST_ADMIN, 'Cannot Delete Last Admin')
export const errSystemError = (message: string) => new Error(`System Error: ${message}`)
