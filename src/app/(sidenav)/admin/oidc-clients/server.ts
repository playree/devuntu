'use server'

import { safeAuthAction } from '@/lib/action-server'
import { auth, OIDC_PROVIDER_SCOPES } from '@/lib/auth'
import { errSystemError } from '@/lib/error'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { scAddOidcClient, scDeleteOidcClient, scSetOidcClientDisabled, scUpdateOidcClient } from '@/lib/schema'
import { headers } from 'next/headers'

/**
 * 一覧・削除・無効化は Prisma を直接参照する。
 * better-auth の `getOAuthClients` / `deleteOAuthClient` は `userId` が自分のものだけを対象にするため、
 * 動的登録(`userId` が NULL)も他の管理者が登録したクライアントも扱えない。
 * 作成と更新は入力検証とシークレットのハッシュ保存があるので better-auth の API のまま使う。
 */

/** 手動登録(管理画面から作成)のクライアント。作成者の userId が入っている */
export const getOidcClients = safeAuthAction
  .metadata({ actionName: 'getOidcClients', role: 'admin' })
  .action(async ({ ctx }) => {
    const clients = await prisma.oauthClient.findMany({
      where: { userId: { not: null } },
      select: {
        clientId: true,
        name: true,
        redirectUris: true,
        skipConsent: true,
        requirePKCE: true,
        userId: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return clients.map(({ clientId, name, redirectUris, skipConsent, requirePKCE, userId }) => ({
      clientId,
      clientName: name ?? '',
      redirectUri: redirectUris[0] ?? '',
      skipConsent: skipConsent ?? false,
      requirePkce: requirePKCE ?? false,
      // 更新は better-auth 側で所有者チェックが入るため、自分が登録したものだけ編集させる
      isOwn: userId === ctx.user.id,
    }))
  })

/** 動的登録(RFC 7591)のクライアント。登録時にセッションが無いので userId は NULL になる */
export const getDynamicOidcClients = safeAuthAction
  .metadata({ actionName: 'getDynamicOidcClients', role: 'admin' })
  .action(async () => {
    const clients = await prisma.oauthClient.findMany({
      where: { userId: null },
      select: {
        clientId: true,
        name: true,
        redirectUris: true,
        disabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    return clients.map(({ clientId, name, redirectUris, disabled, createdAt }) => ({
      clientId,
      clientName: name ?? '',
      redirectUri: redirectUris[0] ?? '',
      enabled: !disabled,
      createdAt,
    }))
  })

export const addOidcClient = safeAuthAction
  .metadata({ actionName: 'addOidcClient', role: 'admin' })
  .inputSchema(scAddOidcClient)
  .action(async ({ parsedInput: { clientName, redirectUri, skipConsent, requirePkce } }) => {
    const res = await auth.api.adminCreateOAuthClient({
      headers: await headers(),
      body: {
        client_name: clientName,
        redirect_uris: [redirectUri],
        client_secret_expires_at: 0,
        skip_consent: skipConsent,
        require_pkce: requirePkce,
        scope: OIDC_PROVIDER_SCOPES.join(' '),
      },
    })
    logger.info(res, 'auth.api.adminCreateOAuthClient')
    if (!res.client_secret) {
      throw errSystemError('client_secret is empty')
    }
    return { clientId: res.client_id, clientSecret: res.client_secret }
  })

export const updateOidcClient = safeAuthAction
  .metadata({ actionName: 'updateOidcClient', role: 'admin' })
  .inputSchema(scUpdateOidcClient)
  .action(async ({ parsedInput: { clientId, clientName, redirectUri, skipConsent } }) => {
    const res = await auth.api.adminUpdateOAuthClient({
      headers: await headers(),
      body: {
        client_id: clientId,
        update: {
          client_name: clientName,
          redirect_uris: [redirectUri],
          skip_consent: skipConsent,
        },
      },
    })
    logger.info(res, 'auth.api.adminUpdateOAuthClient')
    return { clientId: res.client_id }
  })

/**
 * 無効化したクライアントは `/oauth2/authorize` が `client_disabled` で弾き、
 * 同意画面が使う `getOAuthClientPublic` も 404 を返すようになる。
 * 発行済みトークンは残るので、完全に断つ場合は削除する。
 */
export const setOidcClientDisabled = safeAuthAction
  .metadata({ actionName: 'setOidcClientDisabled', role: 'admin' })
  .inputSchema(scSetOidcClientDisabled)
  .action(async ({ parsedInput: { clientId, disabled } }) => {
    await prisma.oauthClient.update({ where: { clientId }, data: { disabled } })
    logger.info({ clientId, disabled }, 'setOidcClientDisabled')
    return { clientId }
  })

/** トークン・同意・リソースリンクは外部キーの Cascade で一緒に消える */
export const deleteOidcClient = safeAuthAction
  .metadata({ actionName: 'deleteOidcClient', role: 'admin' })
  .inputSchema(scDeleteOidcClient)
  .action(async ({ parsedInput: { clientId } }) => {
    await prisma.oauthClient.delete({ where: { clientId } })
    logger.info({ clientId }, 'deleteOidcClient')
    return { clientId }
  })
