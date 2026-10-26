/**
 * 動的クライアント登録(RFC 7591)で受け付けるリダイレクトURIの判定。
 *
 * `POST /oauth2/register` は未認証で叩けるようにしてあり、MCP クライアントが自分で登録してくる。
 * 登録できてもデータは読めない(ログインと同意、リソース側の権限チェックが別に効く)が、
 * 認可コードの戻り先だけは絞っておく。ループバックと private-use スキームに限っておけば、
 * 発行されたコードは必ず利用者自身の端末へ戻るため、外部サーバーへコードを流すクライアントを
 * 登録できない。claude.ai のようにサーバー側で戻りを受ける MCP クライアントは、管理者が
 * `OIDC_DCR_ALLOWED_REDIRECT_URIS` で戻り先を完全一致で列挙したときだけ受け付ける。
 *
 * 判定は引数だけで決まる純粋関数にして `tests/lib/oauth/oauth-registration.test.ts` の対象にする
 * (env / prisma / logger には依存させない)。
 */

/** ループバックとみなすホスト名。IPv6 は URL がブラケット付きで返す */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * private-use スキームとして受け付けないもの。
 * better-auth 側でも弾かれるが、ここで通してしまうと登録の意図が読めなくなるので同じ集合を持つ。
 */
const FORBIDDEN_SCHEMES = new Set(['file:', 'ftp:', 'mailto:', 'javascript:', 'data:', 'vbscript:'])

/**
 * ローカルに閉じたリダイレクトURIか。
 *
 * - `http://localhost` / `127.0.0.1` / `[::1]`(ポートとパスは任意)
 * - 逆ドメイン形式の private-use スキーム(`com.example.app:/oauth` など)。
 *   形式の妥当性は better-auth の native クライアント検証に任せ、ここではスキームの体裁だけ見る
 */
export const isLocalRedirectUri = (uri: string): boolean => {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }

  if (url.protocol === 'http:') {
    return LOOPBACK_HOSTNAMES.has(url.hostname)
  }
  if (url.protocol === 'https:') {
    return false
  }

  if (FORBIDDEN_SCHEMES.has(url.protocol)) {
    return false
  }
  // 逆ドメイン形式(ドットを含む)だけを private-use スキームとして扱う
  return url.protocol.slice(0, -1).includes('.')
}

/**
 * 自分自身を指すホスト名か。`hostname` は URL が正規化した値(`127.1` → `127.0.0.1` など)を受け取る。
 * IPv4 の `127.0.0.0/8`、IPv6 の `::1` と IPv4 射影アドレス、`localhost` とそのサブドメイン(RFC 6761)を含む。
 */
const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.replace(/\.$/, '')
  return (
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    host === '[::1]' ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  )
}

/**
 * `OIDC_DCR_ALLOWED_REDIRECT_URIS` に書ける URI か。
 * 登録時は `native` として better-auth に検証させるため、そこで通らない形(http・ループバックの https・
 * 資格情報やフラグメント付き)は設定の時点で弾く。
 */
export const isAllowableRedirectUri = (uri: string): boolean => {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    !isLoopbackHostname(url.hostname) &&
    !url.username &&
    !url.password &&
    !uri.includes('#')
  )
}

/**
 * 登録要求のリダイレクトURIをすべて受け付けられるか。
 * ローカルに閉じたものか、`allowedUris`(管理者が信頼した戻り先)に完全一致するものだけを通す。
 * 1つでも外部へ戻るものが混ざっていれば登録ごと拒否する。
 * `authorization_code` には redirect_uris が必須なので、空・未指定も通さない。
 * 本文のスキーマ検証より前に呼ばれるため、配列でない値もここで拒否する。
 */
export const isAllowedRegistration = (redirectUris: unknown, allowedUris: readonly string[] = []): boolean =>
  Array.isArray(redirectUris) &&
  redirectUris.length > 0 &&
  redirectUris.every((uri) => typeof uri === 'string' && (isLocalRedirectUri(uri) || allowedUris.includes(uri)))
