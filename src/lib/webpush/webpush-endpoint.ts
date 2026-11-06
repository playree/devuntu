/**
 * 送信先エンドポイントの検査
 *
 * 保存したエンドポイントは送信時に `web-push` がそのまま接続先にするため、利用者が申告した
 * URL がサーバーの接続先になる。社内向けのアドレスを登録されると内部へ HTTP リクエストを
 * 打たせられるので、公開のプッシュサービスに収まる形だけを通す。
 *
 * ここで見るのは URL の形だけで、名前解決した先のアドレスは送信時に `webpush-address.ts` が確かめる
 * (同じ判定 `isPrivateAddress` を使う)。
 *
 * NOTE: このファイルはスキーマ経由でクライアントからも import されるため、
 * サーバー専用の処理は置かない。
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * インターネットの宛先として使えない IPv4 か。
 *
 * 私設アドレスだけでなく、割り当てられていない予約範囲も落とす。ベンチマーク用の
 * 198.18.0.0/15 のように、閉じた網で普通に使われていて内部へ届いてしまう範囲があるため。
 */
const isPrivateIpv4 = (octets: number[]): boolean => {
  const [a, b, c] = octets
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
    (a === 100 && b >= 64 && b <= 127) ||
    // 192.0.0.0/24(IETF プロトコル割り当て) / 192.0.2.0/24(TEST-NET-1)
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    // 198.18.0.0/15(ベンチマーク用)
    (a === 198 && (b === 18 || b === 19)) ||
    // 198.51.100.0/24(TEST-NET-2)
    (a === 198 && b === 51 && c === 100) ||
    // 203.0.113.0/24(TEST-NET-3)
    (a === 203 && b === 0 && c === 113) ||
    // 224.0.0.0/4(マルチキャスト) / 240.0.0.0/4(予約・ブロードキャスト)
    a >= 224
  )
}

/** `::` の省略を戻して 8 個のグループにする。末尾の点付き IPv4(`::ffff:1.2.3.4`)も読む。形が違えば null */
const expandIpv6 = (address: string): number[] | null => {
  const v4 = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address)
  if (v4) {
    const [a, b, c, d] = v4[2].split('.').map(Number)
    address = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
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

/** 2 グループ(32 ビット)を IPv4 の 4 組へ */
const toOctets = (high: number, low: number): number[] => [high >> 8, high & 0xff, low >> 8, low & 0xff]

/** ループバック・ユニークローカル・リンクローカルなどを指す IPv6 か */
const isPrivateIpv6 = (address: string): boolean => {
  const groups = expandIpv6(address)
  // 読めない形は宛先として使えないので内部扱いにする(送信時の名前解決の結果にも使うため)
  if (!groups || groups.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff)) {
    return true
  }
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  const zeroUntil = (end: number) => groups.slice(0, end).every((group) => group === 0)

  // :: (未指定) / ::1 (ループバック)
  if (zeroUntil(7) && g7 <= 1) {
    return true
  }
  // ::a.b.c.d(IPv4 互換) / ::ffff:0:0/96(IPv4 射影)は、下位 32 ビットを IPv4 として見る
  if (zeroUntil(5) && (g5 === 0 || g5 === 0xffff)) {
    return isPrivateIpv4(toOctets(g6, g7))
  }
  // 64:ff9b::/96(NAT64)は、下位 32 ビットの IPv4 へ変換されて届く
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4(toOctets(g6, g7))
  }
  // 64:ff9b:1::/48(閉じた網の NAT64)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) {
    return true
  }
  // 2002::/16(6to4)は、続く 32 ビットの IPv4 へ届く
  if (g0 === 0x2002) {
    return isPrivateIpv4(toOctets(g1, g2))
  }
  return (
    // fc00::/7(ユニークローカル)
    (g0 >= 0xfc00 && g0 <= 0xfdff) ||
    // fe80::/10(リンクローカル) / fec0::/10(サイトローカル。廃止済み)
    (g0 >= 0xfe80 && g0 <= 0xfeff) ||
    // ff00::/8(マルチキャスト)
    g0 >= 0xff00 ||
    // 2001:db8::/32(文書用)
    (g0 === 0x2001 && g1 === 0xdb8)
  )
}

/**
 * インターネットの宛先として使えない IP アドレスか(角括弧なしの IPv6 / 点付き IPv4)。
 * 名前解決の結果を確かめるのにも使う。IP アドレスの形でなければ false。
 */
export const isPrivateAddress = (address: string): boolean => {
  if (address.includes(':')) {
    return isPrivateIpv6(address.toLowerCase())
  }
  const octets = IPV4_PATTERN.exec(address)
  return octets ? isPrivateIpv4(octets.slice(1).map(Number)) : false
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
  return isPrivateAddress(host)
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
