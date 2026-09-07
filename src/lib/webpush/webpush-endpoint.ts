/**
 * 送信先エンドポイントの検査
 *
 * 保存したエンドポイントは送信時に `web-push` がそのまま接続先にするため、利用者が申告した
 * URL がサーバーの接続先になる。社内向けのアドレスを登録されると内部へ HTTP リクエストを
 * 打たせられるので、公開のプッシュサービスに収まる形だけを通す。
 *
 * 名前解決の結果までは追わない(解決した先が私設アドレスになるホストは通る)。DNS を挟むと
 * 検査と送信の間で答えが変わるため防ぎ切れず、送信は VAPID 署名付きの POST に限られるので、
 * 形の検査で足りると判断している。
 *
 * NOTE: このファイルはスキーマ経由でクライアントからも import されるため、
 * サーバー専用の処理は置かない。
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** ループバック・私設・リンクローカルなどを指す IPv4 か */
const isPrivateIpv4 = (octets: number[]): boolean => {
  const [a, b] = octets
  return (
    // 0.0.0.0/8(未指定) / 10.0.0.0/8 / 127.0.0.0/8(ループバック)
    a === 0 ||
    a === 10 ||
    a === 127 ||
    // 169.254.0.0/16(リンクローカル)
    (a === 169 && b === 254) ||
    // 172.16.0.0/12
    (a === 172 && b >= 16 && b <= 31) ||
    // 192.168.0.0/16
    (a === 192 && b === 168) ||
    // 100.64.0.0/10(キャリアグレード NAT)
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** `::` の省略を戻して 8 個のグループにする。形が違えば null */
const expandIpv6 = (address: string): number[] | null => {
  const parts = address.split('::')
  if (parts.length > 2) {
    return null
  }
  const toGroups = (part: string) => (part ? part.split(':').map((group) => Number.parseInt(group, 16)) : [])
  const head = toGroups(parts[0])

  // 省略が無い場合は 8 個揃っていなければならない
  if (parts.length === 1) {
    return head.length === 8 ? head : null
  }

  const tail = toGroups(parts[1])
  const omitted = 8 - head.length - tail.length
  if (omitted < 0) {
    return null
  }
  return [...head, ...Array<number>(omitted).fill(0), ...tail]
}

/** ループバック・ユニークローカル・リンクローカルなどを指す IPv6 か */
const isPrivateIpv6 = (address: string): boolean => {
  const groups = expandIpv6(address)
  if (!groups) {
    return false
  }

  // :: (未指定) / ::1 (ループバック)
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1) {
    return true
  }
  // fc00::/7(ユニークローカル) / fe80::/10(リンクローカル)
  if ((groups[0] >= 0xfc00 && groups[0] <= 0xfdff) || (groups[0] >= 0xfe80 && groups[0] <= 0xfebf)) {
    return true
  }
  // ::ffff:0:0/96 は IPv4 を射影したものなので、下位 32 ビットを IPv4 として見る
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPrivateIpv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff])
  }
  return false
}

/**
 * 内部を指すホストか。
 *
 * `URL` は 10 進や 16 進で書いた IPv4(`2130706433` など)も点付き 4 組へ正規化するので、
 * 表記を変えた抜け道は `URL` 側で塞がれている。
 */
const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true
  }
  // IPv6 は `URL.hostname` では角括弧で囲まれる
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPrivateIpv6(host.slice(1, -1))
  }

  const octets = IPV4_PATTERN.exec(host)
  return octets ? isPrivateIpv4(octets.slice(1).map(Number)) : false
}

/** 送信先として通してよいエンドポイントか */
export const isAllowedWebPushEndpoint = (endpoint: string): boolean => {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }

  // 暗号化した本文とはいえ平文で運ぶ理由が無い。プッシュサービスはどれも HTTPS
  if (url.protocol !== 'https:') {
    return false
  }
  // 資格情報付きの URL と既定以外のポートはプッシュサービスの形ではない
  if (url.username || url.password || url.port) {
    return false
  }
  return !isPrivateHost(url.hostname)
}
