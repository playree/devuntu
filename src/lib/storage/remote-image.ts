import { lookup } from 'node:dns/promises'
import { logger } from '../logger'
import { MAX_IMAGE_SIZE } from '../schema/schema'

/**
 * 外部URLの画像を取得する。
 *
 * OIDC/ソーシャルログインで得た `picture` を Devuntu 側へコピーするために使う。
 * ログインのクリティカルパスで走るので、取得できない場合は例外にせず undefined を返して
 * サインインをそのまま続けさせる(次回ログインで再試行される)。
 *
 * 取得先はIdPが申告したURLで、そのIdPは認証そのものを委ねている相手なので信用の前提は変わらない。
 * 自ホスト運用ではIdPがプライベートネットワークに居る構成が普通にあるため、プライベートアドレスは
 * 遮断しない。ただしクラウドのメタデータサービスだけは正当な取得先になりえず、
 * 踏み台にされたときの被害が大きいので名前解決の結果で弾く。
 * 残りはスキーム・リダイレクト段数・サイズ・時間で被害の上限を抑える。
 */

const TIMEOUT_MS = 5000
const MAX_REDIRECTS = 3

/** IPv4射影(`::ffff:a.b.c.d`)を素のIPv4に戻す */
const toPlainV4 = (address: string) => /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] ?? address

/**
 * リンクローカル(IPv4 169.254.0.0/16 / IPv6 fe80::/10)と、そこに置かれる
 * クラウドのインスタンスメタデータ、および未指定アドレス。
 */
const isBlockedAddress = (address: string) => {
  const addr = toPlainV4(address.toLowerCase())
  if (addr.includes(':')) {
    // AWS の IPv6 メタデータは ULA なので、ULA 全体ではなくこのアドレスだけを落とす
    return addr === '::' || addr === 'fd00:ec2::254' || /^fe[89ab]/.test(addr)
  }
  const [a, b] = addr.split('.').map(Number)
  return a === 0 || (a === 169 && b === 254)
}

/**
 * 名前解決してから宛先を確かめる。ホスト名でメタデータサービスを指されても弾くため。
 *
 * 解決してから fetch が繋ぐまでの間に応答が変わる余地(DNSリバインディング)は残るが、
 * 取得先はIdPが申告したURLなので、そこまでの攻撃者はすでに認証を握っている。
 */
const isAllowedHost = async (hostname: string) => {
  try {
    const addresses = await lookup(hostname, { all: true })
    return addresses.length > 0 && !addresses.some(({ address }) => isBlockedAddress(address))
  } catch {
    // 引けない宛先はどのみち取得できない
    return false
  }
}

/** `http:` / `https:` の絶対URLだけを通す。相対パスはここで弾かれる */
const parseFetchableUrl = (url: string) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
}

/**
 * 上限を超えた時点で読み取りを打ち切る。
 * `Content-Length` は省略も過少申告もできるため、実際に読んだバイト数で判断する。
 */
const readCapped = async (body: ReadableStream<Uint8Array>, limit: number) => {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > limit) {
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

export const fetchRemoteImage = async (url: string): Promise<Uint8Array | undefined> => {
  const origin = parseFetchableUrl(url)
  if (!origin) {
    logger.warn({ url }, 'remote image url is not fetchable')
    return undefined
  }
  let target: URL = origin

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // リダイレクトのたびに確かめる。1ホップ目だけ見ても迂回されるため
    if (!(await isAllowedHost(target.hostname))) {
      logger.warn({ url, host: target.hostname }, 'remote image host is not allowed')
      return undefined
    }

    let res: Response
    try {
      res = await fetch(target, {
        // 自前で追うことで、リダイレクト先のスキームも毎回検証する
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      logger.warn({ err, url }, 'remote image request failed')
      return undefined
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      const next: URL | undefined = location ? parseFetchableUrl(new URL(location, target).toString()) : undefined
      if (!next) {
        logger.warn({ url, status: res.status }, 'remote image redirect is not followable')
        return undefined
      }
      target = next
      continue
    }

    if (!res.ok || !res.body) {
      logger.warn({ url, status: res.status }, 'remote image responded with error')
      return undefined
    }

    const image = await readCapped(res.body, MAX_IMAGE_SIZE).catch((err) => {
      logger.warn({ err, url }, 'remote image read failed')
      return undefined
    })
    if (!image) {
      logger.warn({ url }, 'remote image is empty or too large')
      return undefined
    }
    return image
  }

  logger.warn({ url }, 'remote image exceeded redirect limit')
  return undefined
}
