'use client'

import { MultiButton } from '@/components/general/button'
import { FlexCol } from '@/components/general/flex'
import { NoticePanel } from '@/components/general/panel'
import { ArrowTopRightOnSquareIcon, PuzzlePieceIcon, ShieldCheckIcon, XMarkIcon } from '@/components/icon'
import { notify } from '@/components/notify'
import { SingleLayout } from '@/components/single-layout'
import { parseAction } from '@/lib/action/action-client'
import { authClient } from '@/lib/auth/auth-client'
import { ClientError, CONSENT_INVALID } from '@/lib/error'
import { buildSignedOAuthQuery, consentScopeLocaleItem } from '@/lib/oauth/oauth-consent'
import { textStyles } from '@/lib/style'
import { useLocale } from '@/locale/client'
import { Avatar, cn, Separator } from '@heroui/react'
import { FC, useState } from 'react'
import { submitConsent } from './server'

const ExternalLink: FC<{ href: string; children: string }> = ({ href, children }) => (
  <a className='inline-flex items-center gap-1 text-sm underline' href={href} target='_blank' rel='noreferrer'>
    {children}
    <ArrowTopRightOnSquareIcon className='size-3.5' />
  </a>
)

export const ConsentClient: FC<{
  isValid: boolean
  /** 動的登録されたクライアント(管理者が承認していない)かどうか */
  isUnverified: boolean
  clientName?: string
  clientUri?: string
  logoUri?: string
  tosUri?: string
  policyUri?: string
  scopes: string[]
  claims: string[]
}> = ({ isValid, isUnverified, clientName, clientUri, logoUri, tosUri, policyUri, scopes, claims }) => {
  const { t } = useLocale()
  const { data: session } = authClient.useSession()
  const [pending, setPending] = useState<'allow' | 'deny'>()
  const [isInvalid, setIsInvalid] = useState(!isValid)

  const appName = clientName || t('no_name')

  const submit = async (accept: boolean) => {
    // 署名付きクエリはURLにしか無いので、ここで組み立ててサーバーへ戻す
    const oauthQuery = buildSignedOAuthQuery(window.location.search)
    if (!oauthQuery) {
      setIsInvalid(true)
      return
    }

    setPending(accept ? 'allow' : 'deny')
    try {
      const { url } = await parseAction(submitConsent({ accept, oauthQuery }))
      // 遷移先はクライアントの redirect_uri(別オリジン)になるので router では飛ばせない
      window.location.assign(url)
    } catch (e) {
      setPending(undefined)
      if (e instanceof ClientError && e.errorType === CONSENT_INVALID) {
        setIsInvalid(true)
        notify.warn(t('msg_consent_invalid'))
        return
      }
      throw e
    }
  }

  return (
    <SingleLayout icon={<ShieldCheckIcon />} title={t('consent')}>
      {isInvalid ? (
        <NoticePanel>{t('msg_consent_invalid')}</NoticePanel>
      ) : (
        <FlexCol className='gap-4'>
          <div className='flex items-center gap-2'>
            <Avatar // ロゴはクライアント登録の任意URLなので、読み込めない場合はアイコンで代替する
              size='sm'
            >
              <Avatar.Image src={logoUri ?? ''} />
              <Avatar.Fallback>
                <PuzzlePieceIcon className='size-5' />
              </Avatar.Fallback>
            </Avatar>
            <FlexCol>
              <div className='font-semibold'>{appName}</div>
              {clientUri && <ExternalLink href={clientUri}>{clientUri}</ExternalLink>}
            </FlexCol>
          </div>

          {isUnverified && <NoticePanel className='text-xs'>{t('msg_consent_unverified_client')}</NoticePanel>}

          <div className='text-sm'>{t('msg_consent_request', { client: appName })}</div>

          <FlexCol className='gap-1'>
            {scopes.map((scope) => {
              const item = consentScopeLocaleItem(scope)
              return (
                <div key={scope} className='flex items-start gap-2 text-sm'>
                  <ShieldCheckIcon className='mt-0.5 size-4 shrink-0' />
                  <span>{item ? t(item) : scope}</span>
                </div>
              )
            })}
            {claims.length > 0 && (
              <div className={cn(textStyles().light(), 'ml-6 font-mono text-xs')}>{claims.join(', ')}</div>
            )}
          </FlexCol>

          <Separator />

          <FlexCol className='gap-1'>
            <div className={cn(textStyles().light(), 'text-xs')}>{t('msg_consent_note')}</div>
            {session?.user.email && (
              <div className={cn(textStyles().superlight(), 'truncate text-xs')}>{session.user.email}</div>
            )}
            {(tosUri || policyUri) && (
              <div className='flex gap-3'>
                {tosUri && <ExternalLink href={tosUri}>{t('terms_of_service')}</ExternalLink>}
                {policyUri && <ExternalLink href={policyUri}>{t('privacy_policy')}</ExternalLink>}
              </div>
            )}
          </FlexCol>

          <div className='flex items-center justify-between'>
            <MultiButton
              variant='ghost'
              icon={<XMarkIcon />}
              isPending={pending === 'deny'}
              isDisabled={pending === 'allow'}
              onPress={() => submit(false)}
            >
              {t('cancel')}
            </MultiButton>
            <MultiButton
              icon={<ShieldCheckIcon />}
              isPending={pending === 'allow'}
              isDisabled={pending === 'deny'}
              onPress={() => submit(true)}
            >
              {t('allow')}
            </MultiButton>
          </div>
        </FlexCol>
      )}
    </SingleLayout>
  )
}
