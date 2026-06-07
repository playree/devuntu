export const makePath = (path: string, params?: Record<string, string>) => {
  if (params) {
    const queryString = new URLSearchParams(params).toString()
    return `${path}?${queryString}`
  }
  return path
}
