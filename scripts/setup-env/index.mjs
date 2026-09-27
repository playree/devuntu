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
import { currentLocale, setLocale } from '../i18n.mjs'
import { diffEnv, isSecretKey, maskSecret, parseEnvFile, quoteEnvValue, serializeEnv } from './env-file.mjs'
import { t } from './messages.mjs'
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
  validateGitlabUrls,
  validateMailFrom,
  validatePort,
  validateRequired,
  validateTimezone,
  validateUrl,
  validateVapidSubject,
} from './spec.mjs'

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
  process.stdout.write(t('usage'))
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
  say(color('red', t('no_tty')))
  say(t('no_tty_hint'))
  say('  docker compose run --rm tools setup-env')
  say('  pnpm setup:env')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stderr })
rl.on('SIGINT', () => {
  say(color('yellow', `\n${t('aborted')}`))
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
      say(color('yellow', `\n${t('aborted')}`))
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
      warn(t('required'))
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
      note(t('treated_as', result.value))
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
    warn(t('answer_yes_no'))
  }
}

/** 選択肢は番号で選ばせる。綴り違いで別の値に倒れるのを防ぐ */
const askChoice = async (label, choices, def) => {
  say(`${color('cyan', '?')} ${label}`)
  choices.forEach((choice, i) => say(`    ${i + 1}) ${choice.label ?? choice}`))
  const values = choices.map((choice) => choice.value ?? choice)
  const defIndex = values.indexOf(def)
  for (;;) {
    const answer = (await question(`  ${t('choice_number')}${defIndex >= 0 ? ` [${defIndex + 1}]` : ''}: `)).trim()
    if (answer === '' && defIndex >= 0) {
      return values[defIndex]
    }
    const index = Number(answer)
    if (Number.isInteger(index) && index >= 1 && index <= values.length) {
      return values[index - 1]
    }
    warn(t('choose_number', values.length))
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
      say(color('red', t('path_is_directory', file)))
      say(t('path_is_directory_hint'))
      say(`  sudo rm -rf ${file}`)
      process.exit(1)
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      say(color('red', t('cannot_read', file)))
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
    warn(t('s3_config_broken', s3ConfigPath))
  }
}
const prevS3Credentials = prevS3Config?.identities?.find((i) => i?.name === S3_IDENTITY_NAME)?.credentials?.[0]

const has = (key) => prev[key] !== undefined && prev[key] !== ''
const prevOr = (key, fallback) => (has(key) ? prev[key] : fallback)
const prevBool = (key, fallback) => (has(key) ? prev[key].trim().toLowerCase() === 'true' : fallback)

/**
 * 表示言語は、環境変数(docker では既存の .env.docker から env_file で渡る)→ 既存ファイル → 質問の順で決める。
 * ここまでの出力は環境変数だけで決まる(未設定なら英語)。
 * 質問で決めた場合は、その答えを DEFAULT_LOCALE にも使う(同じことを2度尋ねない)
 */
let chosenLocale
if (!process.env.DEFAULT_LOCALE) {
  if (has('DEFAULT_LOCALE')) {
    setLocale(prev.DEFAULT_LOCALE)
  } else {
    chosenLocale = await askChoice(
      'Language / 言語 (DEFAULT_LOCALE)',
      [
        { value: 'en', label: 'English' },
        { value: 'ja', label: '日本語' },
      ],
      'en',
    )
    setLocale(chosenLocale)
    say()
  }
}

say(color(['bold'], t('intro_title')))
note(t('intro_out_dir', outDir))
note(t('intro_enter_default'))
if (prevEnvText) {
  note(t('intro_loaded_existing'))
}

const env = {}
const db = {}

// ---
// A. 基本
// ---
section(t('section_basic'))
if (chosenLocale) {
  env.DEFAULT_LOCALE = chosenLocale
  note(`DEFAULT_LOCALE = ${chosenLocale}`)
} else {
  env.DEFAULT_LOCALE = await ask({
    label: t('q_default_locale'),
    def: prevOr('DEFAULT_LOCALE', currentLocale()),
    validate: validateChoice(LOCALES),
    help: t('q_default_locale_help', LOCALES.join(' / ')),
  })
  // 以降の質問と書き出す見出しを、保存する DEFAULT_LOCALE の言語に揃える
  setLocale(env.DEFAULT_LOCALE)
}
env.DEFAULT_TIMEZONE = await ask({
  label: t('q_default_timezone'),
  def: prevOr('DEFAULT_TIMEZONE', DEFAULTS.DEFAULT_TIMEZONE),
  validate: validateTimezone,
})

// ---
// B. データベース
// ---
section(t('section_database'))
/**
 * 既定値の引き元。旧構成からの移行では `.env.db` がまだ無いため、
 * `.env.docker` の `DATABASE_URL` を分解して既存のボリュームと同じ値を引き継ぐ。
 */
const existingDbCreds =
  (prevDb.POSTGRES_PASSWORD
    ? { user: prevDb.POSTGRES_USER, password: prevDb.POSTGRES_PASSWORD, db: prevDb.POSTGRES_DB }
    : undefined) ?? parseDatabaseUrl(prev.DATABASE_URL)

// 既存が外部DBを指している場合に Enter で同梱DBへ書き換わらないよう、現状を既定にする
const useBundledDb = await askYesNo(t('q_use_bundled_db'), isBundledDbUrl(prev.DATABASE_URL) ?? true)
const dbUser = await ask({
  label: t('q_db_user'),
  def: existingDbCreds?.user || DEFAULTS.POSTGRES_USER,
  validate: validateRequired,
})
const dbPassword = await ask({
  label: t('q_db_password'),
  def: existingDbCreds?.password || generatePassword(),
  validate: validateRequired,
  secret: true,
  help: existingDbCreds?.password ? undefined : t('generated_default'),
})
const dbName = await ask({
  label: t('q_db_name'),
  def: existingDbCreds?.db || DEFAULTS.POSTGRES_DB,
  validate: validateRequired,
})
db.POSTGRES_USER = dbUser
db.POSTGRES_PASSWORD = dbPassword
db.POSTGRES_DB = dbName

if (existingDbCreds?.password && existingDbCreds.password !== dbPassword) {
  for (const line of t('db_password_changed')) {
    warn(line)
  }
}

if (useBundledDb) {
  env.DATABASE_URL = buildDatabaseUrl({ user: dbUser, password: dbPassword, db: dbName })
  note(`DATABASE_URL = ${buildDatabaseUrl({ user: dbUser, password: '********', db: dbName })}`)
} else {
  env.DATABASE_URL = await ask({
    label: t('q_database_url'),
    def: prev.DATABASE_URL,
    validate: validateDatabaseUrl,
    secret: true,
    help: t('q_database_url_help'),
  })
  note(t('bundled_db_removable'))
}

// ---
// C. 認証
// ---
section(t('section_auth'))
env.BETTER_AUTH_URL = await ask({
  label: t('q_better_auth_url'),
  def: prev.BETTER_AUTH_URL,
  validate: validateBetterAuthUrl,
  help: t('q_better_auth_url_help'),
})

if (has('BETTER_AUTH_SECRET')) {
  env.BETTER_AUTH_SECRET = (await askYesNo(t('q_regenerate_auth_secret'), false))
    ? generateSecret()
    : prev.BETTER_AUTH_SECRET
} else {
  env.BETTER_AUTH_SECRET = generateSecret()
  note(t('auth_secret_generated'))
}

const disablePasswordAuth = await askYesNo(t('q_disable_password_auth'), prevBool('DISABLE_PASSWORD_AUTH', true))
env.DISABLE_PASSWORD_AUTH = String(disablePasswordAuth)
if (!disablePasswordAuth) {
  const twoFa = await askYesNo(t('q_two_fa_required'), prevBool('TWO_FA_REQUIRED', true))
  env.TWO_FA_REQUIRED = String(twoFa)
  if (twoFa) {
    note(t('two_fa_note'))
  }
}

env.OIDC_DCR_ENABLED = String(await askYesNo(t('q_oidc_dcr'), prevBool('OIDC_DCR_ENABLED', true)))

// ---
// D. メール
// ---
section(t('section_mail'))
if (disablePasswordAuth) {
  note(t('otp_only_note'))
}
let mailSend = await askChoice(
  t('q_mail_send'),
  [
    { value: 'smtp', label: 'smtp' },
    { value: 'sendgrid', label: 'sendgrid' },
    { value: 'sendmail', label: 'sendmail' },
    { value: 'debug', label: t('mail_debug_label') },
    { value: '', label: t('mail_none_label') },
  ],
  // 既存ファイルに MAIL_SEND が無いのは「メールを送信しない」構成。
  // ここで smtp を既定にすると、Enter だけで MAIL_FROM や SMTP_HOST の入力を強制してしまう
  prevOr('MAIL_SEND', prevEnvText ? '' : 'smtp'),
)

if (mailSend === '' && disablePasswordAuth) {
  warn(t('mail_none_warn'))
  if (!(await askYesNo(t('q_mail_none_confirm'), false))) {
    mailSend = await askChoice(
      t('q_mail_send'),
      MAIL_SEND_MODES.map((m) => ({ value: m, label: m })),
      'smtp',
    )
  }
}

if (mailSend !== '') {
  env.MAIL_SEND = mailSend
  env.MAIL_FROM = await ask({
    label: t('q_mail_from'),
    def: prev.MAIL_FROM,
    validate: validateMailFrom,
  })
  if (mailSend === 'sendgrid') {
    env.SENDGRID_API_KEY = await ask({
      label: t('q_sendgrid_api_key'),
      def: prev.SENDGRID_API_KEY,
      validate: validateRequired,
      secret: true,
    })
    if (!env.SENDGRID_API_KEY.startsWith('SG.')) {
      warn(t('sendgrid_key_prefix'))
    }
  } else if (mailSend === 'sendmail') {
    env.SENDMAIL_PATH = await ask({
      label: t('q_sendmail_path'),
      def: prevOr('SENDMAIL_PATH', DEFAULTS.SENDMAIL_PATH),
      validate: validateRequired,
    })
    for (const line of t('sendmail_warn')) {
      warn(line)
    }
  } else if (mailSend === 'smtp') {
    env.SMTP_HOST = await ask({ label: t('q_smtp_host'), def: prev.SMTP_HOST, validate: validateRequired })
    env.SMTP_PORT = await ask({
      label: t('q_smtp_port'),
      def: prevOr('SMTP_PORT', DEFAULTS.SMTP_PORT),
      validate: validatePort,
    })
    const port = Number(env.SMTP_PORT)
    env.SMTP_SECURE = String(await askYesNo(t('q_smtp_secure'), prevBool('SMTP_SECURE', port === 465)))
    env.SMTP_IGNORE_TLS = String(await askYesNo(t('q_smtp_ignore_tls'), prevBool('SMTP_IGNORE_TLS', port === 25)))
    /**
     * 片方だけでは認証できないので、2項目をまとめてゲートで囲む。
     * 空入力は既定値(既存の値)へ戻るため、ゲートが無いと既存の認証情報を
     * 空へ戻す手段が無くなる。
     */
    if (await askYesNo(t('q_smtp_auth'), has('SMTP_USER') || has('SMTP_PASS'))) {
      env.SMTP_USER = await ask({
        label: t('q_smtp_user'),
        def: prev.SMTP_USER,
        validate: validateRequired,
      })
      env.SMTP_PASS = await ask({
        label: t('q_smtp_pass'),
        def: prev.SMTP_PASS,
        validate: validateRequired,
        secret: true,
      })
    }
  } else {
    note(t('mail_debug_note'))
  }
}

// ---
// E. オブジェクトストレージ
// ---
section(t('section_storage'))
const useBundledS3 = await askYesNo(t('q_use_bundled_s3'), isBundledS3Endpoint(prev.S3_ENDPOINT) ?? true)
if (useBundledS3) {
  env.S3_ENDPOINT = BUNDLED_S3_ENDPOINT
  note(`S3_ENDPOINT = ${BUNDLED_S3_ENDPOINT}`)
} else {
  env.S3_ENDPOINT = await ask({
    label: t('q_s3_endpoint'),
    def: prev.S3_ENDPOINT,
    validate: validateUrl,
  })
  env.S3_REGION = await ask({
    label: t('q_s3_region'),
    def: prevOr('S3_REGION', DEFAULTS.S3_REGION),
    validate: validateRequired,
  })
}
env.S3_BUCKET = await ask({
  label: t('q_s3_bucket'),
  def: prevOr('S3_BUCKET', DEFAULTS.S3_BUCKET),
  validate: validateRequired,
  help: t('q_s3_bucket_help'),
})
env.S3_ACCESS_KEY_ID = await ask({
  label: t('q_s3_access_key'),
  def: prevOr('S3_ACCESS_KEY_ID', DEFAULTS.S3_ACCESS_KEY_ID),
  validate: validateRequired,
})
env.S3_SECRET_ACCESS_KEY = await ask({
  label: t('q_s3_secret_key'),
  def: prevOr('S3_SECRET_ACCESS_KEY', generatePassword()),
  validate: validateRequired,
  secret: true,
})
if (useBundledS3) {
  note(t('s3_config_same_values'))
}

// ---
// F. 任意項目
// ---
section(t('section_integrations_optional'))
if (await askYesNo(t('q_google'), has('GOOGLE_CLIENT_ID'))) {
  env.GOOGLE_CLIENT_ID = await ask({
    label: t('q_client_id', 'GOOGLE_CLIENT_ID'),
    def: prev.GOOGLE_CLIENT_ID,
    validate: validateRequired,
  })
  env.GOOGLE_CLIENT_SECRET = await ask({
    label: t('q_client_secret', 'GOOGLE_CLIENT_SECRET'),
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
  if (await askYesNo(t('q_google_sign_in'), useGoogleSignIn)) {
    env.GOOGLE_ALLOWED_DOMAINS = await ask({
      label: t('q_google_allowed_domains'),
      def: prev.GOOGLE_ALLOWED_DOMAINS,
      validate: validateAllowedDomains,
      help: t('q_google_allowed_domains_help'),
    })
  } else {
    note(t('google_calendar_only'))
  }
  say()
  note(t('google_redirect_uris'))
  note(`  ${env.BETTER_AUTH_URL}/api/auth/callback/google`)
  note(`  ${env.BETTER_AUTH_URL}/api/auth/oauth2/callback/google-account`)
}

if (await askYesNo(t('q_slack'), has('SLACK_CLIENT_ID'))) {
  env.SLACK_CLIENT_ID = await ask({
    label: t('q_client_id', 'SLACK_CLIENT_ID'),
    def: prev.SLACK_CLIENT_ID,
    validate: validateRequired,
  })
  env.SLACK_CLIENT_SECRET = await ask({
    label: t('q_client_secret', 'SLACK_CLIENT_SECRET'),
    def: prev.SLACK_CLIENT_SECRET,
    validate: validateRequired,
    secret: true,
  })
  env.SLACK_BOT_TOKEN = await ask({
    label: t('q_slack_bot_token'),
    def: prev.SLACK_BOT_TOKEN,
    validate: validateRequired,
    secret: true,
  })
  if (!env.SLACK_BOT_TOKEN.startsWith('xoxb-')) {
    warn(t('slack_bot_token_prefix'))
  }
  env.SLACK_TEAM_ID = await ask({
    label: t('q_slack_team_id'),
    def: prev.SLACK_TEAM_ID,
    validate: validateRequired,
  })
  if (!env.SLACK_TEAM_ID.startsWith('T')) {
    warn(t('slack_team_id_prefix'))
  }
  env.SLACK_SIGNING_SECRET = await ask({
    label: t('q_slack_signing_secret'),
    def: prev.SLACK_SIGNING_SECRET,
    validate: validateRequired,
    secret: true,
  })
}

if (await askYesNo(t('q_github'), has('GITHUB_WEBHOOK_SECRET'))) {
  if (has('GITHUB_WEBHOOK_SECRET')) {
    env.GITHUB_WEBHOOK_SECRET = prev.GITHUB_WEBHOOK_SECRET
  } else {
    env.GITHUB_WEBHOOK_SECRET = generateSecret()
    note(t('github_secret_generated'))
  }
  note(t('github_payload_url'))
  note(`  ${env.BETTER_AUTH_URL}/api/github/webhook`)
}

if (await askYesNo(t('q_gitlab'), has('GITLAB_URLS'))) {
  env.GITLAB_URLS = await ask({
    label: t('q_gitlab_urls'),
    help: t('q_gitlab_urls_help'),
    def: prev.GITLAB_URLS ?? 'https://gitlab.com',
    validate: validateGitlabUrls,
  })
  note(t('gitlab_webhook_note'))
}

section(t('section_notify_optional'))
if (await askYesNo(t('q_web_push'), has('VAPID_PUBLIC_KEY'))) {
  if (has('VAPID_PUBLIC_KEY') && has('VAPID_PRIVATE_KEY')) {
    if (await askYesNo(t('q_regenerate_vapid'), false)) {
      const keys = generateVapidKeys()
      env.VAPID_PUBLIC_KEY = keys.publicKey
      env.VAPID_PRIVATE_KEY = keys.privateKey
      note(t('vapid_regenerated'))
    } else {
      env.VAPID_PUBLIC_KEY = prev.VAPID_PUBLIC_KEY
      env.VAPID_PRIVATE_KEY = prev.VAPID_PRIVATE_KEY
    }
  } else {
    const keys = generateVapidKeys()
    env.VAPID_PUBLIC_KEY = keys.publicKey
    env.VAPID_PRIVATE_KEY = keys.privateKey
    note(t('vapid_generated'))
  }
  if (has('VAPID_SUBJECT') || (await askYesNo(t('q_change_vapid_subject'), false))) {
    env.VAPID_SUBJECT = await ask({
      label: t('q_vapid_subject'),
      def: prevOr('VAPID_SUBJECT', env.MAIL_FROM ? `mailto:${env.MAIL_FROM}` : undefined),
      validate: validateVapidSubject,
      help: t('q_vapid_subject_help'),
    })
  }
  if (env.BETTER_AUTH_URL.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(env.BETTER_AUTH_URL)) {
    warn(t('web_push_needs_https'))
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
    warn(t('key_not_writable', key, e.message))
  }
}
if (carried.length > 0) {
  say()
  note(t('carried_keys', carried.join(', ')))
}

// ---
// H. 未知キーの扱い
// ---
const knownKeys = new Set(ENV_DOCKER_SECTIONS.flatMap((s) => s.keys))
const unknownKeys = Object.keys(prev).filter((key) => !knownKeys.has(key))
if (unknownKeys.length > 0) {
  say()
  warn(t('unknown_keys', unknownKeys.join(', ')))
  if (await askYesNo(t('q_keep_unknown_keys'), true)) {
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
        say(color('red', t('key_reason', key, reason)))
      }
      say(color('red', t('no_backup_would_lose')))
      say(t('no_backup_would_lose_hint'))
      rl.close()
      process.exit(1)
    }
    for (const { key, reason } of undroppable) {
      warn(t('key_not_writable', key, reason))
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
    say(color('red', t('build_failed', e.message)))
    process.exit(1)
  }
}

const envDockerBody = build({
  header: t('env_docker_header'),
  sections: ENV_DOCKER_SECTIONS,
  values: env,
  extrasTitle: t('env_docker_extras'),
})
const envDbBody = build({
  header: t('env_db_header'),
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

section(t('section_output'))
say(color('bold', `${envDockerPath}`))
say(maskBody(envDockerBody))
say(color('bold', `${envDbPath}`))
say(maskBody(envDbBody))
say(color('bold', `${s3ConfigPath}`))
// identities は複数あり得るので、すべての secretKey をマスクする
say(s3ConfigBody.replace(/("secretKey":\s*)"([^"]*)"/g, (_, head, value) => `${head}"${maskSecret(value)}"`))

if (prevEnvText) {
  const { added, changed, removed } = diffEnv(prev, env)
  say(color('bold', t('diff_title')))
  note(t('diff_summary', added.length, changed.length, removed.length))
  if (added.length > 0) {
    note(t('diff_added', added.join(', ')))
  }
  if (changed.length > 0) {
    note(t('diff_changed', changed.join(', ')))
  }
  if (removed.length > 0) {
    note(t('diff_removed', removed.join(', ')))
  }
}

if (opts['dry-run']) {
  say()
  say(color('yellow', t('dry_run_done')))
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
  warn(t('overwrite_files', existing.map((f) => path.basename(f)).join(', ')))
  if (!(await askYesNo(t('q_write'), true))) {
    say(color('yellow', t('aborted')))
    rl.close()
    process.exit(0)
  }
} else if (!opts.force) {
  say()
  if (!(await askYesNo(t('q_write'), true))) {
    say(color('yellow', t('aborted')))
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
    say(color('red', t('cannot_write_dir', outDir)))
  } else {
    say(color('red', t('write_failed', e.message)))
  }
  // 作り終えていない一時ファイルを残さない
  for (const target of targets) {
    await rm(`${target.path}.tmp`, { force: true }).catch(() => {})
  }
  process.exit(1)
}

say()
say(color('green', t('created')))
note(`${envDockerPath}`)
note(`${envDbPath}`)
note(`${s3ConfigPath}`)
if (existing.length > 0 && opts.backup) {
  note(t('backed_up', suffix))
}
say()
say(color('bold', t('next_steps')))
say('  docker compose up -d')
say(t('next_open_start', env.BETTER_AUTH_URL))
