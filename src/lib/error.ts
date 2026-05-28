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
export const errInvalidOperation = () => new ClientError('INVALID_OPERATION', 'Invalid Operation')
export const errSystemError = (message: string) => new Error(`System Error: ${message}`)
