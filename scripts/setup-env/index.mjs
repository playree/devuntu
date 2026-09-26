/**
 * セルフホスト用の設定ファイル(`.env.docker` / `.env.db` / `seaweedfs-s3.json`)を対話生成する。
 *
 *   docker compose run --rm tools setup-env   # セルフホスト先(compose.yaml だけを配置した状態で実行できる)
 *   pnpm setup:env                            # リポジトリ内
 *
 * `compose.yaml` 1ファイルだけを置いた状態から起動まで到達できるようにするのが目的。
 * 手で書くと、オリジン不一致の `BETTER_AUTH_URL`、`DATABASE_URL` と `POSTGRES_PASSWORD` の
 * 食い違い、真偽値の綴り違いといった、設定した本人が気づけない失敗をしやすい。
 *
 * `@/` エイリアスは Node ランタイムで解決できないため、変数の定義は `spec.mjs` に持たせて
 * `src/lib/env-util.ts` と同名の環境変数として揃えている。
 * 既存ファイルがあれば現在値を各質問の既定値として提示し、Enter で現状維持できる。
 */
import { chown, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs, styleText } from 'node:util'
import { ownerOf } from '../file-owner.mjs'
import { diffEnv, isSecretKey, maskSecret, parseEnvFile, quoteEnvValue, serializeEnv } from './env-file.mjs'
import {
  BUNDLED_S3_ENDPOINT,
  DEFAULTS,
  ENV_DB_SECTIONS,
  ENV_DOCKER_SECTIONS,
  LOCALES,
  MAIL_SEND_MODES,
  MANUAL_KEYS,
  S3_IDENTITY_NAME,
  buildDatabaseUrl,
  buildSeaweedS3Config,
  generatePassword,
  generateSecret,
  generateVapidKeys,
  isBundledDbUrl,
  isBundledS3Endpoint,
  parseDatabaseUrl,
  validateAllowedDomains,
  validateBetterAuthUrl,
  validateChoice,
  validateDatabaseUrl,
  validateMailFrom,
  validatePort,
  validateRequired,
  validateTimezone,
  validateUrl,
  validateVapidSubject,
} from './spec.mjs'

const USAGE = `使い方: node scripts/setup-env/index.mjs [オプション]

  --dir <path>   生成先ディレクトリ(既定: カレントディレクトリ)
  --dry-run      ファイルへ書かず、生成内容を表示するだけ
  --force        上書きの確認を省略する
  --no-backup    既存ファイルの .bak を作らない
  --help         この使い方を表示する
`

const { values: opts } = parseArgs({
  options: {
    dir: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    backup: { type: 'boolean', default: true },
    help: { type: 'boolean', default: false },
  },
  // --no-backup のような否定形を受け付けるために必要
  allowNegative: true,
})

if (opts.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}

const outDir = path.resolve(opts.dir ?? process.cwd())

// 画面への出力は stderr へ寄せる。色は stderr が TTY でなければ自動で落ちる
const color = (styles, text) => styleText(styles, text, { stream: process.stderr })
const say = (text = '') => process.stderr.write(`${text}\n`)
const warn = (text) => say(color('yellow', `  ! ${text}`))
const note = (text) => say(color('dim', `  ${text}`))

/**
 * TTY が無い場合は即座に止める。
 * 入力が EOF のままプロンプトを回すと、全項目が既定値のまま書き出されて気づけない。
 */
if (process.stdin.isTTY !== true) {
  say(color('red', '対話的な入力ができません(TTY が割り当てられていません)。'))
  say('次のいずれかで実行してください。')
  say('  docker compose run --rm tools setup-env')
  say('  pnpm setup:env')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stderr })
rl.on('SIGINT', () => {
  say(color('yellow', '\n中断しました(ファイルは作成していません)'))
  process.exit(130)
})

// ---
// プロンプト
// ---

/**
 * Ctrl+D(EOF)は Ctrl+C と同じ中断として扱う。
 * 既定では readline が AbortError を投げ、スタックトレースだけが残る。
 */
const question = async (prompt) => {
  try {
    return await rl.question(prompt)
  } catch (e) {
    if (e?.code === 'ABORT_ERR') {
      say(color('yellow', '\n中断しました(ファイルは作成していません)'))
      process.exit(130)
    }
    throw e
  }
}

/**
 * env ファイルへ書き出せる値か。
 *
 * 書けない値(シングルクォート・改行・末尾のバックスラッシュ)は、全項目に答えた後の
 * `serializeEnv` で例外になる。そこは書き出し用の try の外なので、
 * 利用者はスタックトレースだけを受け取ることになる。入力の時点で弾く。
 */
const writable = (value) => {
  try {
    quoteEnvValue(value)
    return true
  } catch (e) {
    warn(e.message)
    return false
  }
}

/**
 * 1項目を尋ねる。
 *
 * 秘密値は既定値をマスクして表示する(Enter で実値を維持できるので、画面と
 * スクロールバックに秘密を残さないため)。入力中のエコー抑制は readline の内部APIに
 * 依存するので行わない。
 */
const ask = async ({ label, help, def, validate, secret = false }) => {
  if (help) {
    note(help)
  }
  for (;;) {
    const shown = def === undefined || def === '' ? '' : ` [${secret ? maskSecret(def) : def}]`
    const answer = (await question(`${color('cyan', '?')} ${label}${shown}: `)).trim()
    const input = answer === '' ? def : answer
    if (input === undefined || input === '') {
      warn('必須です')
      continue
    }
    if (!validate) {
      if (!writable(input)) {
        continue
      }
      return input
    }
    const result = validate(input)
    if (result.error) {
      warn(result.error)
      continue
    }
    if (!writable(result.value)) {
      continue
    }
    if (result.warn) {
      warn(result.warn)
    }
    if (result.normalized) {
      note(`${result.value} として扱います`)
    }
    return result.value
  }
}

const askYesNo = async (label, defaultYes) => {
  for (;;) {
    const answer = (await question(`${color('cyan', '?')} ${label} [${defaultYes ? 'Y/n' : 'y/N'}]: `))
      .trim()
      .toLowerCase()
    if (answer === '') {
      return defaultYes
    }
    if (answer === 'y' || answer === 'yes') {
      return true
    }
    if (answer === 'n' || answer === 'no') {
      return false
    }
    warn('y または n で答えてください')
  }
}

/** 選択肢は番号で選ばせる。綴り違いで別の値に倒れるのを防ぐ */
const askChoice = async (label, choices, def) => {
  say(`${color('cyan', '?')} ${label}`)
  choices.forEach((choice, i) => say(`    ${i + 1}) ${choice.label ?? choice}`))
  const values = choices.map((choice) => choice.value ?? choice)
  const defIndex = values.indexOf(def)
  for (;;) {
    const answer = (await question(`  番号${defIndex >= 0 ? ` [${defIndex + 1}]` : ''}: `)).trim()
    if (answer === '' && defIndex >= 0) {
      return values[defIndex]
    }
    const index = Number(answer)
    if (Number.isInteger(index) && index >= 1 && index <= values.length) {
      return values[index - 1]
    }
    warn(`1〜${values.length} の番号で選んでください`)
  }
}

const section = (title) => {
  say()
  say(color(['bold', 'cyan'], `── ${title} ──`))
}

// ---
// 既存ファイルの読み込み
// ---

const readTextIfExists = async (file) => {
  try {
    return await readFile(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined
    }
    /**
     * 古い compose.yaml で未作成のまま `up` すると、Docker が設定ファイルと同名の
     * ディレクトリを作ってしまう。そのまま読むと EISDIR のスタックトレースになるだけなので、
     * 何を消せばよいかを伝える。
     */
    if (e.code === 'EISDIR') {
      say(color('red', `${file} がディレクトリになっています。`))
      say('Docker が設定ファイルの代わりに作ったディレクトリです。削除してから実行し直してください。')
      say(`  sudo rm -rf ${file}`)
      process.exit(1)
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      say(color('red', `${file} を読めません。ファイルの所有者を確認してください`))
      process.exit(1)
    }
    throw e
  }
}

const envDockerPath = path.join(outDir, '.env.docker')
const envDbPath = path.join(outDir, '.env.db')
const s3ConfigPath = path.join(outDir, 'seaweedfs-s3.json')

const prevEnvText = await readTextIfExists(envDockerPath)
const prev = prevEnvText ? parseEnvFile(prevEnvText) : {}
const prevDbText = await readTextIfExists(envDbPath)
const prevDb = prevDbText ? parseEnvFile(prevDbText) : {}
const prevS3Text = await readTextIfExists(s3ConfigPath)

let prevS3Config
if (prevS3Text) {
  try {
    prevS3Config = JSON.parse(prevS3Text)
  } catch {
    warn(`${s3ConfigPath} が JSON として読めないため、内容を作り直します`)
  }
}
const prevS3Credentials = prevS3Config?.identities?.find((i) => i?.name === S3_IDENTITY_NAME)?.credentials?.[0]

const has = (key) => prev[key] !== undefined && prev[key] !== ''
const prevOr = (key, fallback) => (has(key) ? prev[key] : fallback)
const prevBool = (key, fallback) => (has(key) ? prev[key].trim().toLowerCase() === 'true' : fallback)

say(color(['bold'], 'Devuntu セルフホストの設定ファイルを作成します'))
note(`生成先: ${outDir}`)
note('Enter だけを押すと [] 内の既定値を使います。秘密の値は既定値をマスクして表示します')
if (prevEnvText) {
  note('既存の .env.docker を読み込み、現在値を既定値にしています')
}

const env = {}
const db = {}

// ---
// A. 基本
// ---
section('基本')
env.DEFAULT_LOCALE = await ask({
  label: 'デフォルトロケール (DEFAULT_LOCALE)',
  def: prevOr('DEFAULT_LOCALE', DEFAULTS.DEFAULT_LOCALE),
  validate: validateChoice(LOCALES),
  help: `${LOCALES.join(' / ')} から選びます`,
})
env.DEFAULT_TIMEZONE = await ask({
  label: 'デフォルトタイムゾーン (DEFAULT_TIMEZONE)',
  def: prevOr('DEFAULT_TIMEZONE', DEFAULTS.DEFAULT_TIMEZONE),
  validate: validateTimezone,
})

// ---
// B. データベース
// ---
section('データベース')
/**
 * 既定値の引き元。旧構成からの移行では `.env.db` がまだ無いため、
 * `.env.docker` の `DATABASE_URL` を分解して既存のボリュームと同じ値を引き継ぐ。
 */
const existingDbCreds =
  (prevDb.POSTGRES_PASSWORD
    ? { user: prevDb.POSTGRES_USER, password: prevDb.POSTGRES_PASSWORD, db: prevDb.POSTGRES_DB }
    : undefined) ?? parseDatabaseUrl(prev.DATABASE_URL)

// 既存が外部DBを指している場合に Enter で同梱DBへ書き換わらないよう、現状を既定にする
const useBundledDb = await askYesNo(
  'compose.yaml に同梱の db サービスを使いますか?',
  isBundledDbUrl(prev.DATABASE_URL) ?? true,
)
const dbUser = await ask({
  label: 'DBユーザー (POSTGRES_USER)',
  def: existingDbCreds?.user || DEFAULTS.POSTGRES_USER,
  validate: validateRequired,
})
const dbPassword = await ask({
  label: 'DBパスワード (POSTGRES_PASSWORD)',
  def: existingDbCreds?.password || generatePassword(),
  validate: validateRequired,
  secret: true,
  help: existingDbCreds?.password ? undefined : '自動生成した値を既定にしています',
})
const dbName = await ask({
  label: 'DB名 (POSTGRES_DB)',
  def: existingDbCreds?.db || DEFAULTS.POSTGRES_DB,
  validate: validateRequired,
})
db.POSTGRES_USER = dbUser
db.POSTGRES_PASSWORD = dbPassword
db.POSTGRES_DB = dbName

if (existingDbCreds?.password && existingDbCreds.password !== dbPassword) {
  warn('postgres は初回起動時にボリュームを初期化するため、既に docker compose up 済みの環境では')
  warn('パスワードを変えても DB 側の実際のパスワードは変わらず、認証エラーになります。')
  warn('変更する場合はボリューム(pgdata)を作り直すか、DB 側で ALTER USER してください。')
}

if (useBundledDb) {
  env.DATABASE_URL = buildDatabaseUrl({ user: dbUser, password: dbPassword, db: dbName })
  note(`DATABASE_URL = ${buildDatabaseUrl({ user: dbUser, password: '********', db: dbName })}`)
} else {
  env.DATABASE_URL = await ask({
    label: '接続URL (DATABASE_URL)',
    def: prev.DATABASE_URL,
    validate: validateDatabaseUrl,
    secret: true,
    help: '外部のPostgreSQLへ接続します',
  })
  note('同梱の db サービスを使わない場合、compose.yaml の db サービスは削除してかまいません')
}

// ---
// C. 認証
// ---
section('認証')
env.BETTER_AUTH_URL = await ask({
  label: '公開するベースURL (BETTER_AUTH_URL)',
  def: prev.BETTER_AUTH_URL,
  validate: validateBetterAuthUrl,
  help: '実際に配信するオリジンと完全に一致させます(不一致だとサインインのPOSTが拒否されます)',
})

if (has('BETTER_AUTH_SECRET')) {
  env.BETTER_AUTH_SECRET = (await askYesNo(
    'BETTER_AUTH_SECRET を再生成しますか?(既存の全セッションが無効になります)',
    false,
  ))
    ? generateSecret()
    : prev.BETTER_AUTH_SECRET
} else {
  env.BETTER_AUTH_SECRET = generateSecret()
  note('BETTER_AUTH_SECRET を自動生成しました')
}

const disablePasswordAuth = await askYesNo(
  'パスワード認証を無効にし、メールOTPのみでサインインしますか? (DISABLE_PASSWORD_AUTH)',
  prevBool('DISABLE_PASSWORD_AUTH', true),
)
env.DISABLE_PASSWORD_AUTH = String(disablePasswordAuth)
if (!disablePasswordAuth) {
  const twoFa = await askYesNo('2要素認証を必須にしますか? (TWO_FA_REQUIRED)', prevBool('TWO_FA_REQUIRED', true))
  env.TWO_FA_REQUIRED = String(twoFa)
  if (twoFa) {
    note('利用者は初回サインイン後に2要素認証の設定が必須になります')
  }
}

env.OIDC_DCR_ENABLED = String(
  await askYesNo('MCPサーバーを公開しますか? (OIDC_DCR_ENABLED)', prevBool('OIDC_DCR_ENABLED', true)),
)

// ---
// D. メール
// ---
section('メール')
if (disablePasswordAuth) {
  note('パスワード認証を無効にしたため、メールOTPが唯一のサインイン手段になります')
}
let mailSend = await askChoice(
  '送信方式 (MAIL_SEND)',
  [
    { value: 'smtp', label: 'smtp' },
    { value: 'sendgrid', label: 'sendgrid' },
    { value: 'sendmail', label: 'sendmail' },
    { value: 'debug', label: 'debug(送信せずサーバーログへ出力)' },
    { value: '', label: '設定しない(メールを送信しない)' },
  ],
  // 既存ファイルに MAIL_SEND が無いのは「メールを送信しない」構成。
  // ここで smtp を既定にすると、Enter だけで MAIL_FROM や SMTP_HOST の入力を強制してしまう
  prevOr('MAIL_SEND', prevEnvText ? '' : 'smtp'),
)

if (mailSend === '' && disablePasswordAuth) {
  warn('メールを送信しないと誰もサインインできません。試用であれば debug を選んでください')
  if (!(await askYesNo('それでもメールを設定しませんか?', false))) {
    mailSend = await askChoice(
      '送信方式 (MAIL_SEND)',
      MAIL_SEND_MODES.map((m) => ({ value: m, label: m })),
      'smtp',
    )
  }
}

if (mailSend !== '') {
  env.MAIL_SEND = mailSend
  env.MAIL_FROM = await ask({
    label: '送信元アドレス (MAIL_FROM)',
    def: prev.MAIL_FROM,
    validate: validateMailFrom,
  })
  if (mailSend === 'sendgrid') {
    env.SENDGRID_API_KEY = await ask({
      label: 'SendGrid APIキー (SENDGRID_API_KEY)',
      def: prev.SENDGRID_API_KEY,
      validate: validateRequired,
      secret: true,
    })
    if (!env.SENDGRID_API_KEY.startsWith('SG.')) {
      warn('SendGrid のAPIキーは通常 SG. で始まります')
    }
  } else if (mailSend === 'sendmail') {
    env.SENDMAIL_PATH = await ask({
      label: 'sendmail のパス (SENDMAIL_PATH)',
      def: prevOr('SENDMAIL_PATH', DEFAULTS.SENDMAIL_PATH),
      validate: validateRequired,
    })
    warn('アプリのコンテナ(node:24-slim ベース)に sendmail は入っていません。')
    warn('コンテナ内で解決できる場合のみ動きます。通常は smtp / sendgrid を選んでください')
  } else if (mailSend === 'smtp') {
    env.SMTP_HOST = await ask({ label: 'SMTPホスト (SMTP_HOST)', def: prev.SMTP_HOST, validate: validateRequired })
    env.SMTP_PORT = await ask({
      label: 'SMTPポート (SMTP_PORT)',
      def: prevOr('SMTP_PORT', DEFAULTS.SMTP_PORT),
      validate: validatePort,
    })
    const port = Number(env.SMTP_PORT)
    env.SMTP_SECURE = String(
      await askYesNo('SSL/TLSで接続しますか? (SMTP_SECURE)', prevBool('SMTP_SECURE', port === 465)),
    )
    env.SMTP_IGNORE_TLS = String(
      await askYesNo('TLSを使わずに接続しますか? (SMTP_IGNORE_TLS)', prevBool('SMTP_IGNORE_TLS', port === 25)),
    )
    /**
     * 片方だけでは認証できないので、2項目をまとめてゲートで囲む。
     * 空入力は既定値(既存の値)へ戻るため、ゲートが無いと既存の認証情報を
     * 空へ戻す手段が無くなる。
     */
    if (await askYesNo('SMTP認証(ユーザー・パスワード)を設定しますか?', has('SMTP_USER') || has('SMTP_PASS'))) {
      env.SMTP_USER = await ask({
        label: 'SMTP認証ユーザー (SMTP_USER)',
        def: prev.SMTP_USER,
        validate: validateRequired,
      })
      env.SMTP_PASS = await ask({
        label: 'SMTP認証パスワード (SMTP_PASS)',
        def: prev.SMTP_PASS,
        validate: validateRequired,
        secret: true,
      })
    }
  } else {
    note('OTP は送信されず、サーバーログ(docker compose logs devuntu)に出力されます')
  }
}

// ---
// E. オブジェクトストレージ
// ---
section('オブジェクトストレージ')
const useBundledS3 = await askYesNo(
  'compose.yaml に同梱の SeaweedFS を使いますか?',
  isBundledS3Endpoint(prev.S3_ENDPOINT) ?? true,
)
if (useBundledS3) {
  env.S3_ENDPOINT = BUNDLED_S3_ENDPOINT
  note(`S3_ENDPOINT = ${BUNDLED_S3_ENDPOINT}`)
} else {
  env.S3_ENDPOINT = await ask({
    label: 'S3 APIのエンドポイント (S3_ENDPOINT)',
    def: prev.S3_ENDPOINT,
    validate: validateUrl,
  })
  env.S3_REGION = await ask({
    label: 'リージョン (S3_REGION)',
    def: prevOr('S3_REGION', DEFAULTS.S3_REGION),
    validate: validateRequired,
  })
}
env.S3_BUCKET = await ask({
  label: 'バケット名 (S3_BUCKET)',
  def: prevOr('S3_BUCKET', DEFAULTS.S3_BUCKET),
  validate: validateRequired,
  help: '存在しない場合は初回アップロード時に自動作成されます',
})
env.S3_ACCESS_KEY_ID = await ask({
  label: 'アクセスキー (S3_ACCESS_KEY_ID)',
  def: prevOr('S3_ACCESS_KEY_ID', DEFAULTS.S3_ACCESS_KEY_ID),
  validate: validateRequired,
})
env.S3_SECRET_ACCESS_KEY = await ask({
  label: 'シークレットキー (S3_SECRET_ACCESS_KEY)',
  def: prevOr('S3_SECRET_ACCESS_KEY', generatePassword()),
  validate: validateRequired,
  secret: true,
})
if (useBundledS3) {
  note('同じ値で seaweedfs-s3.json も生成します')
}

// ---
// F. 任意項目
// ---
section('外部サービス連携(任意)')
if (await askYesNo('Googleアカウント連携を設定しますか?', has('GOOGLE_CLIENT_ID'))) {
  env.GOOGLE_CLIENT_ID = await ask({
    label: 'クライアントID (GOOGLE_CLIENT_ID)',
    def: prev.GOOGLE_CLIENT_ID,
    validate: validateRequired,
  })
  env.GOOGLE_CLIENT_SECRET = await ask({
    label: 'クライアントシークレット (GOOGLE_CLIENT_SECRET)',
    def: prev.GOOGLE_CLIENT_SECRET,
    validate: validateRequired,
    secret: true,
  })
  /**
   * 許可ドメインが既にあれば維持、Google 未設定からの新規追加なら有効、
   * カレンダー連携のみの既存構成だけ無効を既定にする。
   * 固定で有効にすると、その構成では既定値の無い許可ドメインを入力するまで終われない。
   */
  const useGoogleSignIn = has('GOOGLE_ALLOWED_DOMAINS') || !has('GOOGLE_CLIENT_ID')
  if (await askYesNo('Googleサインイン(アカウントでのログイン)に使いますか?', useGoogleSignIn)) {
    env.GOOGLE_ALLOWED_DOMAINS = await ask({
      label: 'サインインを許可するドメイン (GOOGLE_ALLOWED_DOMAINS)',
      def: prev.GOOGLE_ALLOWED_DOMAINS,
      validate: validateAllowedDomains,
      help: 'カンマ区切り。未設定だと全ドメインのサインインが拒否されます',
    })
  } else {
    note('カレンダー連携のみ有効です(Googleサインインは全ドメイン拒否になります)')
  }
  say()
  note('Google Cloud 側に登録するリダイレクトURI:')
  note(`  ${env.BETTER_AUTH_URL}/api/auth/callback/google`)
  note(`  ${env.BETTER_AUTH_URL}/api/auth/oauth2/callback/google-account`)
}

if (await askYesNo('Slack連携を設定しますか?', has('SLACK_CLIENT_ID'))) {
  env.SLACK_CLIENT_ID = await ask({
    label: 'クライアントID (SLACK_CLIENT_ID)',
    def: prev.SLACK_CLIENT_ID,
    validate: validateRequired,
  })
  env.SLACK_CLIENT_SECRET = await ask({
    label: 'クライアントシークレット (SLACK_CLIENT_SECRET)',
    def: prev.SLACK_CLIENT_SECRET,
    validate: validateRequired,
    secret: true,
  })
  env.SLACK_BOT_TOKEN = await ask({
    label: 'Botトークン (SLACK_BOT_TOKEN)',
    def: prev.SLACK_BOT_TOKEN,
    validate: validateRequired,
    secret: true,
  })
  if (!env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
    warn('Botトークンは通常 xoxb- で始まります')
  }
  env.SLACK_TEAM_ID = await ask({
    label: 'ワークスペースID (SLACK_TEAM_ID)',
    def: prev.SLACK_TEAM_ID,
    validate: validateRequired,
  })
  if (!env.SLACK_TEAM_ID.startsWith('T')) {
    warn('ワークスペースIDは通常 T で始まります')
  }
  env.SLACK_SIGNING_SECRET = await ask({
    label: '署名シークレット (SLACK_SIGNING_SECRET)',
    def: prev.SLACK_SIGNING_SECRET,
    validate: validateRequired,
    secret: true,
  })
}

section('通知(任意)')
if (await askYesNo('Webプッシュ通知を有効にしますか?', has('VAPID_PUBLIC_KEY'))) {
  if (has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY')) {
    if (await askYesNo('VAPID鍵を再生成しますか?(既存の購読がすべて無効になります)', false)) {
      const keys = generateVapidKeys()
      env.VAPID_PUBLIC_KEY = keys.publicKey
      env.VAPID_PRIVATE_KEY = keys.privateKey
      note('VAPID鍵を再生成しました')
    } else {
      env.VAPID_PUBLIC_KEY = prev.VAPID_PUBLIC_KEY
      env.VAPID_PRIVATE_KEY = prev.VAPID_PRIVATE_KEY
    }
  } else {
    const keys = generateVapidKeys()
    env.VAPID_PUBLIC_KEY = keys.publicKey
    env.VAPID_PRIVATE_KEY = keys.privateKey
    note('VAPID鍵を自動生成しました')
  }
  if (has('VAPID_SUBJECT') || (await askYesNo('プッシュサービスからの連絡先を既定から変更しますか?', false))) {
    env.VAPID_SUBJECT = await ask({
      label: '連絡先 (VAPID_SUBJECT)',
      def: prevOr('VAPID_SUBJECT', env.MAIL_FROM ? `mailto:${env.MAIL_FROM}` : undefined),
      validate: validateVapidSubject,
      help: 'mailto: または https: で始めます',
    })
  }
  if (env.BETTER_AUTH_URL.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.BETTER_AUTH_URL)) {
    warn('HTTPSでないとブラウザがプッシュ通知の購読を許可しません')
  }
}

// ---
// G. 対話で尋ねない設定の引き継ぎ
// ---
/**
 * 質問から外した設定は、既存ファイルの値をそのまま書き戻す。
 * 尋ねなくなったことで、手で設定した値が再実行で消えるのを防ぐ。
 */
const carried = []
for (const key of MANUAL_KEYS) {
  if (!has(key)) {
    continue
  }
  try {
    quoteEnvValue(prev[key])
    env[key] = prev[key]
    carried.push(key)
  } catch (e) {
    warn(`${key} は${e.message}。このキーは残せません(元の値は退避ファイルに残ります)`)
  }
}
if (carried.length > 0) {
  say()
  note(`次の設定は尋ねずに現在値を引き継ぎます: ${carried.join(', ')}`)
}

// ---
// H. 未知キーの扱い
// ---
const knownKeys = new Set(ENV_DOCKER_SECTIONS.flatMap((s) => s.keys))
const unknownKeys = Object.keys(prev).filter((key) => !knownKeys.has(key))
if (unknownKeys.length > 0) {
  say()
  warn(`このスクリプトが管理していないキーが既存の .env.docker にあります: ${unknownKeys.join(', ')}`)
  if (await askYesNo('そのまま残しますか?', true)) {
    const undroppable = []
    for (const key of unknownKeys) {
      try {
        quoteEnvValue(prev[key])
        env[key] = prev[key]
      } catch (e) {
        undroppable.push({ key, reason: e.message })
      }
    }
    /**
     * 残したいと言われたのに書き出せないキーは、こちらの判断で落とすことになる。
     * `.bak` があれば元の行が残るので復元できるが、`--no-backup` では上書きと同時に
     * 値が失われる。黙って消さず、退避を有効にして実行し直させる。
     */
    if (undroppable.length > 0 && !opts.backup) {
      say()
      for (const { key, reason } of undroppable) {
        say(color('red', `${key} は${reason}。`))
      }
      say(color('red', '--no-backup では上書きと同時にこの値が失われるため中断しました。'))
      say('--no-backup を外して実行するか、該当キーを先に手で退避してください。')
      rl.close()
      process.exit(1)
    }
    for (const { key, reason } of undroppable) {
      warn(`${key} は${reason}。このキーは残せません(元の値は退避ファイルに残ります)`)
    }
  }
}

// ---
// 確認
// ---

/**
 * 入力の時点で書き出せない値は弾いているが、想定外の値が残っていた場合に
 * スタックトレースだけを見せないようにする。
 */
const build = (params) => {
  try {
    return serializeEnv(params)
  } catch (e) {
    say()
    say(color('red', `設定を組み立てられませんでした: ${e.message}`))
    process.exit(1)
  }
}

const envDockerBody = build({
  header: [
    'Devuntu セルフホスト用の環境変数(docker compose run --rm tools setup-env で再生成できる)',
    '全変数の一覧は docs/environment-variables.md を参照',
  ],
  sections: ENV_DOCKER_SECTIONS,
  values: env,
  extrasTitle: 'その他(このスクリプトが管理していない設定)',
})
const envDbBody = build({
  header: [
    'compose.yaml の db サービス(postgres)が読む変数',
    '外部のPostgreSQLを使う場合、このファイルと db サービスは不要',
  ],
  sections: ENV_DB_SECTIONS,
  values: db,
})
/**
 * SeaweedFS 側の資格情報。
 *
 * 同梱の SeaweedFS を使う場合はアプリと同じ値を書く。外部のS3を使う場合は、
 * その資格情報をこのファイルへ複製しない(用途の違うファイルへ秘密を広げないため)。
 * 既定の Compose は `s3` サービスを常に起動しこのファイルを必須マウントするので、
 * 使わない場合でも生成自体は省けない。
 */
const s3Identity = useBundledS3
  ? { accessKey: env.S3_ACCESS_KEY_ID, secretKey: env.S3_SECRET_ACCESS_KEY }
  : (prevS3Credentials ?? { accessKey: S3_IDENTITY_NAME, secretKey: generatePassword() })
const s3ConfigBody = `${JSON.stringify(buildSeaweedS3Config(s3Identity, prevS3Config), null, 2)}\n`

/** spec が管理しているキー。ここに無いものは未知キーとして扱う */
const managedKeys = new Set([...ENV_DOCKER_SECTIONS, ...ENV_DB_SECTIONS].flatMap((s) => s.keys))

/** プレビューは秘密値を伏せて出す */
const maskBody = (body) =>
  body
    .split('\n')
    .map((line) => {
      const matched = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!matched || !isSecretKey(matched[1], managedKeys)) {
        return line
      }
      return `${matched[1]}=${maskSecret(matched[2].replace(/^'|'$/g, ''))}`
    })
    .join('\n')

section('生成内容')
say(color('bold', `${envDockerPath}`))
say(maskBody(envDockerBody))
say(color('bold', `${envDbPath}`))
say(maskBody(envDbBody))
say(color('bold', `${s3ConfigPath}`))
// identities は複数あり得るので、すべての secretKey をマスクする
say(s3ConfigBody.replace(/("secretKey":\s*)"([^"]*)"/g, (_, head, value) => `${head}"${maskSecret(value)}"`))

if (prevEnvText) {
  const { added, changed, removed } = diffEnv(prev, env)
  say(color('bold', '.env.docker の差分'))
  note(`追加 ${added.length} / 変更 ${changed.length} / 削除 ${removed.length}`)
  if (added.length > 0) {
    note(`追加: ${added.join(', ')}`)
  }
  if (changed.length > 0) {
    note(`変更: ${changed.join(', ')}`)
  }
  if (removed.length > 0) {
    note(`削除: ${removed.join(', ')}`)
  }
}

if (opts['dry-run']) {
  say()
  say(color('yellow', '--dry-run のためファイルは作成していません'))
  rl.close()
  process.exit(0)
}

const existing = [envDockerPath, envDbPath, s3ConfigPath].filter(
  (file) =>
    (file === envDockerPath && prevEnvText) ||
    (file === envDbPath && prevDbText) ||
    (file === s3ConfigPath && prevS3Text),
)
if (existing.length > 0 && !opts.force) {
  say()
  warn(`次のファイルを上書きします: ${existing.map((f) => path.basename(f)).join(', ')}`)
  if (!(await askYesNo('書き出しますか?', true))) {
    say(color('yellow', '中断しました(ファイルは作成していません)'))
    rl.close()
    process.exit(0)
  }
} else if (!opts.force) {
  say()
  if (!(await askYesNo('書き出しますか?', true))) {
    say(color('yellow', '中断しました(ファイルは作成していません)'))
    rl.close()
    process.exit(0)
  }
}

rl.close()

// ---
// 書き出し
// ---

/** `backup-db.sh` / `backup-s3.mjs` と揃えた `YYYYMMDD_HHMMSS`(ローカル時刻) */
const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 生成物はいずれも資格情報を含む。s3 コンテナは root で動くので 0600 でも読める */
const MODE = 0o600

await mkdir(outDir, { recursive: true })
// 生成物の所有者を出力先ディレクトリに合わせる(root のコンテナから書いてもホスト側で扱えるように)
const owner = ownerOf(outDir)
const suffix = stamp()

const targets = [
  { path: envDockerPath, body: envDockerBody, previousText: prevEnvText },
  { path: envDbPath, body: envDbBody, previousText: prevDbText },
  { path: s3ConfigPath, body: s3ConfigBody, previousText: prevS3Text },
]

/**
 * 3ファイルをまとめて確定する。
 *
 * DBパスワードとS3の資格情報は3ファイルに跨がっているため、途中で失敗して一部だけが
 * 新しい値になると、どのファイルが正しいのか分からない状態で残る。
 * 先に全ての退避と一時ファイルを作り、差し替えは最後にまとめて行う。
 * 差し替え中に失敗した場合は、それまでに置き換えたファイルを元へ戻す。
 */
const commit = async () => {
  for (const target of targets) {
    if (target.previousText !== undefined && opts.backup) {
      const bak = `${target.path}.${suffix}.bak`
      await writeFile(bak, target.previousText, { mode: MODE })
      // 本体と同じ所有者にする。root のコンテナから書くとホスト側で整理できなくなる
      if (owner) {
        await chown(bak, owner.uid, owner.gid).catch(() => {})
      }
    }
    await writeFile(`${target.path}.tmp`, target.body, { mode: MODE })
  }

  const replaced = []
  try {
    for (const target of targets) {
      await rename(`${target.path}.tmp`, target.path)
      replaced.push(target)
      if (owner) {
        await chown(target.path, owner.uid, owner.gid).catch(() => {})
      }
    }
  } catch (e) {
    for (const target of replaced) {
      if (target.previousText === undefined) {
        await rm(target.path, { force: true }).catch(() => {})
      } else {
        await writeFile(target.path, target.previousText, { mode: MODE }).catch(() => {})
      }
    }
    throw e
  }
}

try {
  await commit()
} catch (e) {
  say()
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    say(color('red', `${outDir} へ書き込めません。ディレクトリの所有者を確認するか、sudo を付けて実行してください`))
  } else {
    say(color('red', `書き出しに失敗しました: ${e.message}`))
  }
  // 作り終えていない一時ファイルを残さない
  for (const target of targets) {
    await rm(`${target.path}.tmp`, { force: true }).catch(() => {})
  }
  process.exit(1)
}

say()
say(color('green', '作成しました:'))
note(`${envDockerPath}`)
note(`${envDbPath}`)
note(`${s3ConfigPath}`)
if (existing.length > 0 && opts.backup) {
  note(`上書き前の内容は *.${suffix}.bak に退避しました`)
}
say()
say(color('bold', '次の手順:'))
say('  docker compose up -d')
say(`  ${env.BETTER_AUTH_URL}/start  を開いて最初の管理者を登録する`)
