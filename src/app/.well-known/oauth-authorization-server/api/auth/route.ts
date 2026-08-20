import { authServerMetadataHandler } from '@/lib/oauth-metadata'

// RFC 8414 のパス挿入形式(issuer のパスを well-known の後ろに付ける)
export const GET = authServerMetadataHandler
