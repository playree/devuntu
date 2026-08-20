import { authServerMetadataHandler } from '@/lib/oauth-metadata'

// issuer(`/api/auth`)直下の形式。MCP クライアントはこちらを先に引くことが多い
export const GET = authServerMetadataHandler
