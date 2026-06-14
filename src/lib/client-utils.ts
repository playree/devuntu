import { ReadonlyURLSearchParams } from 'next/navigation'

export const makePath = (path: string, params?: Record<string, string> | ReadonlyURLSearchParams) => {
  if (params) {
    if (params instanceof ReadonlyURLSearchParams) {
      return `${path}?${params}`
    }
    const queryString = new URLSearchParams(params).toString()
    return `${path}?${queryString}`
  }
  return path
}
