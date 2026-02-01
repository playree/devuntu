export const envClient = {
  get NEXT_PUBLIC_APP_NAME() {
    return process.env.NEXT_PUBLIC_APP_NAME || 'Devuntu'
  },
  get NEXT_PUBLIC_URL() {
    return process.env.NEXT_PUBLIC_URL
  },
}
