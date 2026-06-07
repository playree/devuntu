import { envu } from './env-util'

export const makeUrl = (path: string, params?: Record<string, string>) => {
  const url = new URL(path, envu.server.BETTER_AUTH_URL)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })
  }
  return url
}
