/**
 * Web プッシュの送信先を名前解決の結果で確かめる(サーバー専用)
 *
 * エンドポイントの形の検査(`webpush-endpoint.ts`)だけでは、私設アドレスへ解決されるホスト名
 * (`127.0.0.1.nip.io` など)が通ってしまう。接続に使う名前解決そのものを同じ判定で止めるので、
 * 検査と接続の間に答えを変える DNS リバインディングでも内部へは繋がらない。
 */

import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns'
import { Agent } from 'node:https'
import { isPrivateAddress } from './webpush-endpoint'

const PRIVATE_ADDRESS_CODE = 'EPRIVATEADDRESS'

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** 接続時の名前解決。解決先に内部のアドレスが含まれていれば接続させない */
export const guardedLookup = (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
  dnsLookup(hostname, options, (error, address: string | LookupAddress[], family?: number) => {
    if (error) {
      callback(error, address, family)
      return
    }
    const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address]
    if (addresses.some(isPrivateAddress)) {
      const blocked = Object.assign(new Error('web push host resolves to a private address'), {
        code: PRIVATE_ADDRESS_CODE,
      })
      callback(blocked, address, family)
      return
    }
    callback(null, address, family)
  })
}

/** 送信の失敗が、内部のアドレスへの接続を止めたものか */
export const isPrivateAddressError = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === PRIVATE_ADDRESS_CODE

/** 送信に使う接続。プッシュサービスへの接続を使い回せるよう keepAlive は既定のエージェントと揃える */
export const webPushAgent = new Agent({ keepAlive: true, lookup: guardedLookup as never })
