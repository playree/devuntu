/**
 * セルフホスト用の設定ファイルを組み立てるための定義と純関数群。
 *
 * 変数の必須・既定値は `src/lib/env-util.ts` と `docs/environment-variables.md` に合わせている。
 * `@/` エイリアスは Node ランタイムで解決できないため、`backup-s3.mjs` と同様に
 * アプリのモジュールは読まず、同名の環境変数として定義を持たせている。
 * fs も process も触らないので、そのままテストできる。
 */
import { generateKeyPairSync, randomBytes, randomInt } from 'node:crypto'

/** 同梱の db / s3 サービスへは Compose のネットワーク内で到達する */
export const BUNDLED_DB_HOST = 'db:5432'
export const BUNDLED_S3_ENDPOINT = 'http://s3:8333'

export const DEFAULTS = {
  DEFAULT_LOCALE: 'ja',
  DEFAULT_TIMEZONE: 'Asia/Tokyo',
  POSTGRES_USER: 'devuser',
  POSTGRES_DB: 'devuntu',
  S3_BUCKET: 'devuntu',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'devuntu',
  SENDMAIL_PATH: '/usr/sbin/sendmail',
  SMTP_PORT: '25',
  LOG_LEVEL: 'info',
  MAINTENANCE_ATTACHMENT_MODE: 'delete',
  MAINTENANCE_ATTACHMENT_GRACE_HOURS: '24',
}

export const LOCALES = ['ja', 'en']
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
export const MAIL_SEND_MODES = ['smtp', 'sendgrid', 'sendmail', 'debug']
export const ATTACHMENT_MODES = ['off', 'dry-run', 'delete']

/** `.env.docker` のセクション構成。`docs/environment-variables.md` の見出しと揃えている */
export const ENV_DOCKER_SECTIONS = [
  { title: '基本', keys: ['DEFAULT_LOCALE', 'DEFAULT_TIMEZONE', 'LOG_LEVEL', 'SEARCH_ENGINE_INDEXING'] },
  {
    title: '認証',
    keys: [
      'DATABASE_URL',
      'BETTER_AUTH_URL',
      'BETTER_AUTH_SECRET',
      'DISABLE_PASSWORD_AUTH',
      'TWO_FA_REQUIRED',
      'SESSION_EXPIRES_IN',
      'SESSION_FRESH_AGE',
      'MCP_REFRESH_TOKEN_EXPIRES_IN',
      'OIDC_DCR_ENABLED',
    ],
  },
  {
    title: 'メール',
    keys: [
      'MAIL_SEND',
      'MAIL_FROM',
      'SENDGRID_API_KEY',
      'SENDMAIL_PATH',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_IGNORE_TLS',
      'SMTP_USER',
      'SMTP_PASS',
    ],
  },
  {
    title: 'オブジェクトストレージ',
    keys: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE'],
  },
  {
    title: '外部サービス連携',
    keys: [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_ALLOWED_DOMAINS',
      'SLACK_CLIENT_ID',
      'SLACK_CLIENT_SECRET',
      'SLACK_BOT_TOKEN',
      'SLACK_TEAM_ID',
      'SLACK_SIGNING_SECRET',
      'MAIN_DEVUNTU_URL',
      'MAIN_DEVUNTU_CLIENT_ID',
      'MAIN_DEVUNTU_CLIENT_SECRET',
    ],
  },
  { title: '通知', keys: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'NOTIFY_WORKER_ENABLED'] },
  {
    title: 'メンテナンス',
    keys: ['MAINTENANCE_WORKER_ENABLED', 'MAINTENANCE_ATTACHMENT_MODE', 'MAINTENANCE_ATTACHMENT_GRACE_HOURS'],
  },
  { title: 'ホスト情報の表示', keys: ['LINODE_ID', 'LINODE_PERSONAL_ACCESS_TOKEN'] },
]

/** `.env.db` は postgres の公式イメージが読む変数だけを持つ */
export const ENV_DB_SECTIONS = [{ title: 'PostgreSQL', keys: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'] }]

// ---
// 生成
// ---

/** `openssl rand -base64 32` 相当。`BETTER_AUTH_SECRET` 用 */
export const generateSecret = () => randomBytes(32).toString('base64')

/**
 * パスワードやアクセスキーの自動生成。
 *
 * 文字集合を英数字だけに絞っているのは、`#` が env ファイルでインラインコメントとして解釈され、
 * `@` `:` `/` が `DATABASE_URL` で percent-encoding を要求し、どちらも
 * 設定した本人が気づきにくい壊れ方をするため。
 */
export const generatePassword = (length = 24) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[randomInt(chars.length)]
  }
  return out
}

/**
 * Web プッシュの VAPID 鍵(P-256, base64url)を生成する。
 *
 * `web-push` の `generateVAPIDKeys()` は使えない。standalone ビルドでは Turbopack が
 * `web-push` をサーバーチャンクへバンドルするため、配布イメージの `node_modules` に実体が無い。
 * 公開鍵は非圧縮点(`0x04 || x || y`)、秘密鍵は JWK の `d` で、どちらも同ライブラリが受理する形式。
 */
export const generateVapidKeys = () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  if (!jwk.x || !jwk.y || !jwk.d) {
    throw new Error('VAPID鍵の生成に失敗しました(P-256のJWKに x / y / d が揃っていません)')
  }
  const x = Buffer.from(jwk.x, 'base64url')
  const y = Buffer.from(jwk.y, 'base64url')
  return {
    publicKey: Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url'),
    privateKey: jwk.d,
  }
}

// ---
// 組み立て・抽出
// ---

/** 同梱の db サービス向けの接続URL。パスワードの特殊文字は percent-encoding する */
export const buildDatabaseUrl = ({ user, password, db }) =>
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${BUNDLED_DB_HOST}/${encodeURIComponent(db)}?schema=public`

/** 既存の `DATABASE_URL` を質問の既定値へ流し込むために分解する */
export const parseDatabaseUrl = (value) => {
  if (!value) {
    return undefined
  }
  try {
    const url = new URL(value)
    const db = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!url.hostname || !db) {
      return undefined
    }
    return {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      db,
      host: url.host,
    }
  } catch {
    return undefined
  }
}

/**
 * 既存の設定が同梱の db / s3 サービスを指しているか。
 *
 * 分岐の既定値をこれで決める。固定で「同梱を使う」にしていると、外部のDBやS3を
 * 指している既存ファイルに対して Enter を押しただけで接続先が書き換わる。
 * ホスト名だけを見るのは、ポートを省いた `db` / `s3` も同梱扱いにするため。
 */
const hasHostname = (value, hostname) => {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value).hostname === hostname
  } catch {
    return undefined
  }
}

export const isBundledDbUrl = (url) => hasHostname(url, 'db')
export const isBundledS3Endpoint = (endpoint) => hasHostname(endpoint, 's3')

/** アプリが使う identity の名前。この名前の資格情報だけを差し替える */
export const S3_IDENTITY_NAME = 'devuntu'

/**
 * SeaweedFS の S3 認証情報。既存ファイルがあれば該当箇所だけ差し替える。
 *
 * `identities` は複数持てるため、先頭ではなく名前で探す。利用者が別の identity を
 * 足していた場合に、その資格情報を上書きしないようにしている。
 */
export const buildSeaweedS3Config = ({ accessKey, secretKey }, existing) => {
  const base = existing && Array.isArray(existing.identities) ? structuredClone(existing) : { identities: [] }

  let identity = base.identities.find((i) => i?.name === S3_IDENTITY_NAME)
  if (!identity) {
    identity = { name: S3_IDENTITY_NAME, credentials: [], actions: ['Read', 'Write', 'List', 'Tagging', 'Admin'] }
    base.identities.push(identity)
  }
  if (!Array.isArray(identity.credentials) || identity.credentials.length === 0) {
    identity.credentials = [{}]
  }
  identity.credentials[0] = { ...identity.credentials[0], accessKey, secretKey }
  return base
}

// ---
// 検証
// ---

/**
 * 検証結果。成功と失敗で形を変えず1つの型に揃えている。
 * TypeScript のテストから `allowJs` 経由で読むため、union になると
 * `.error` / `.warn` の参照が型エラーになる。
 *
 * @typedef {object} ValidationResult
 * @property {boolean} ok
 * @property {string} value 正規化後の値(失敗時は空文字)
 * @property {string | undefined} error 失敗の理由
 * @property {string | undefined} warn 続行はできるが伝えるべきこと
 * @property {boolean} normalized 入力から値を書き換えたか
 */

/** @type {(value: string, extra?: { warn?: string, normalized?: boolean }) => ValidationResult} */
const ok = (value, extra) => ({
  ok: true,
  value,
  error: undefined,
  warn: extra?.warn,
  normalized: extra?.normalized ?? false,
})

/** @type {(message: string) => ValidationResult} */
const err = (message) => ({ ok: false, value: '', error: message, warn: undefined, normalized: false })

/**
 * 運用するベースURL。
 *
 * オリジンが完全に一致しないとサインインなどの POST が origin チェックで拒否されるため、
 * パスやクエリを含む入力は受け付けず、末尾スラッシュはこちらで落とす。
 */
export const validateBetterAuthUrl = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  let url
  try {
    url = new URL(text)
  } catch {
    return err('URLとして解釈できません(例: https://devuntu.example.com)')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return err('http:// または https:// で指定してください')
  }
  if (url.search || url.hash) {
    return err('クエリやフラグメントは含められません')
  }
  if (url.pathname !== '/') {
    return err(`パスは含められません(オリジンのみ指定してください: ${url.origin})`)
  }
  const warn =
    url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1'
      ? 'http:// のため Cookie に Secure が付かず、Webプッシュ通知もブラウザに拒否されます'
      : undefined
  return ok(url.origin, { warn, normalized: url.origin !== text })
}

export const validateDatabaseUrl = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  const parsed = parseDatabaseUrl(text)
  if (!parsed) {
    return err('接続URLとして解釈できません(例: postgresql://user:pass@host:5432/dbname?schema=public)')
  }
  const protocol = new URL(text).protocol
  if (protocol !== 'postgresql:' && protocol !== 'postgres:') {
    return err('postgresql:// で指定してください')
  }
  return ok(text)
}

export const validateUrl = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return err('http:// または https:// で指定してください')
    }
  } catch {
    return err('URLとして解釈できません')
  }
  return ok(text)
}

export const validateRequired = (input) => {
  const text = String(input ?? '').trim()
  return text === '' ? err('必須です') : ok(text)
}

export const validateTimezone = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: text })
  } catch {
    return err('タイムゾーン名として解釈できません(例: Asia/Tokyo)')
  }
  return ok(text)
}

export const validateChoice = (choices) => (input) => {
  const text = String(input ?? '').trim()
  return choices.includes(text) ? ok(text) : err(`${choices.join(' / ')} のいずれかを指定してください`)
}

export const validateMailFrom = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? ok(text) : err('メールアドレスの形式で指定してください')
}

export const validatePort = (input) => {
  const text = String(input ?? '').trim()
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err('1〜65535 の整数で指定してください')
  }
  return ok(String(port))
}

export const validatePositiveInt = (min) => (input) => {
  const text = String(input ?? '').trim()
  const value = Number(text)
  if (!Number.isInteger(value) || value < min) {
    return err(`${min} 以上の整数で指定してください`)
  }
  return ok(String(value))
}

/**
 * Googleサインインを許可するドメイン。
 *
 * 未設定だと許可ドメインが空になり全ドメインのサインインが拒否されるため、
 * サインインに使う場合は最低1件を必須にする。
 */
export const validateAllowedDomains = (input) => {
  const domains = String(input ?? '')
    .split(',')
    .map((d) => d.trim().replace(/^@/, ''))
    .filter((d) => d !== '')
  if (domains.length === 0) {
    return err('最低1件必要です(未設定だと全ドメインのサインインが拒否されます)')
  }
  const invalid = domains.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
  if (invalid) {
    return err(`ドメイン名として解釈できません: ${invalid}`)
  }
  return ok(domains.join(','))
}

export const validateVapidSubject = (input) => {
  const text = String(input ?? '').trim()
  if (text === '') {
    return err('必須です')
  }
  return /^(mailto:|https:)/.test(text) ? ok(text) : err('mailto: または https: で始めてください')
}

/** `MAIL_SEND` ごとに追加で必須になるキー */
export const mailRequiredKeys = (mode) => {
  switch (mode) {
    case 'sendgrid':
      return ['MAIL_FROM', 'SENDGRID_API_KEY']
    case 'sendmail':
      return ['MAIL_FROM', 'SENDMAIL_PATH']
    case 'smtp':
      return ['MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT']
    case 'debug':
      return ['MAIL_FROM']
    default:
      return []
  }
}
