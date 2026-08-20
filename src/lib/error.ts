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
export const errInvalidSession = () => new ClientError('INVALID_SESSION', 'Invalid Session')
export const errPermissionDenied = () => new ClientError('PERMISSION_DENIED', 'Permission denied')
export const errNotFound = () => new ClientError('NOT_FOUND', 'Not Found')
export const errValidation = (message: string) => new ClientError('VALIDATION_ERROR', `Validation Error: ${message}`)
export const errCommunication = (message: string) =>
  new ClientError('COMMUNICATION_ERROR', `Communication Error: ${message}`)
export const errInvalidOperation = () => new ClientError('INVALID_OPERATION', 'Invalid Operation')
/** レート制限超過。クライアント側で errorType を見て分岐するため型名を定数で公開する */
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS'
export const errTooManyRequests = () => new ClientError(TOO_MANY_REQUESTS, 'Too Many Requests')
/** 同意要求の署名不正・期限切れ。クライアント側で errorType を見て分岐するため型名を定数で公開する */
export const CONSENT_INVALID = 'CONSENT_INVALID'
export const errConsentInvalid = () => new ClientError(CONSENT_INVALID, 'Invalid Consent Request')
export const errSystemError = (message: string) => new Error(`System Error: ${message}`)
