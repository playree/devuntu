import { isValidTimezone } from './day'
import { errSystemError } from './error'

function getEnv<T extends string = string>(key: string, opts: { required: true }): T
function getEnv<T extends string = string>(key: string, opts: { default: T }): T
function getEnv<T extends string = string>(key: string): T | undefined
function getEnv<T extends string = string>(key: string, opts?: { required?: boolean; default?: T }): T | undefined {
  const value = process.env[key]
  if (!value) {
    if (opts?.default !== undefined) {
      return opts.default
    }
    if (opts?.required) {
      throw errSystemError(`${key} is not set`)
    }
  }
  return value as T | undefined
}

/**
 * 真偽値の環境変数。`true` / `false` 以外は起動時に弾く。
 *
 * 綴り違いを黙って既定の反対側へ倒すと、`SEARCH_ENGINE_INDEXING=ture` で検索結果へ載る、
 * `DISABLE_PASSWORD_AUTH=1` でパスワード認証が消えるといった、設定した本人が気づけない事故になる。
 */
function getEnvBoolean(key: string, opts?: { default?: boolean }): boolean {
  const value = process.env[key]?.trim()
  if (!value) {
    return opts?.default ?? false
  }
  const lower = value.toLowerCase()
  if (lower !== 'true' && lower !== 'false') {
    throw errSystemError(`${key} must be true or false`)
  }
  return lower === 'true'
}

type EnvIntRange = { min?: number; max?: number }

/**
 * 整数の環境変数。整数でない値(`abc` / `1.5` など)や範囲外の値は起動時に弾く。
 *
 * `Number()` の結果をそのまま返すと、綴り違いが NaN のまま下流へ流れ、
 * 比較が常に false になって上限や期限が黙って効かなくなる。
 */
function getEnvInt(key: string, opts: EnvIntRange & { required: true }): number
function getEnvInt(key: string, opts: EnvIntRange & { default: number }): number
function getEnvInt(key: string, opts?: EnvIntRange & { required?: boolean; default?: number }): number | undefined {
  const raw = process.env[key]?.trim()
  if (!raw) {
    if (opts?.default !== undefined) {
      return opts.default
    }
    if (opts?.required) {
      throw errSystemError(`${key} is not set`)
    }
    return undefined
  }

  const value = Number(raw)
  const { min, max } = opts ?? {}
  if (!Number.isSafeInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    const range =
      min !== undefined && max !== undefined
        ? ` between ${min} and ${max}`
        : min !== undefined
          ? ` of at least ${min}`
          : max !== undefined
            ? ` of at most ${max}`
            : ''
    throw errSystemError(`${key} must be an integer${range}`)
  }
  return value
}

const client = {
  // クライアントサイド
  get NEXT_PUBLIC_APP_NAME() {
    return process.env.NEXT_PUBLIC_APP_NAME || 'Devuntu'
  },
}

/**
 * 履歴の保持期間(日)の上限。
 *
 * 保持期間は `now - days * 24h` で削除の境界に直すので、Date の有効範囲
 * (±8,640,000,000,000,000ms = 現在時刻から約1億日)を超えると Invalid Date になる。
 * Prisma は無効な DateTime フィルタを受け付けず、掃除が丸ごと止まるので入口で弾く。
 */
const MAX_RETENTION_DAYS = 100_000_000

/**
 * エージェントの実行履歴として画面に出す最大件数。これより古い実行は一覧に現れない。
 * `AGENT_RUN_KEEP` の下限を兼ねるため、環境変数の定義と同じここに置く。
 */
export const AGENT_RUN_HISTORY_LIMIT = 100

const server = {
  ...client,

  // サーバーサイド

  // 基本
  get NODE_ENV() {
    return getEnv('NODE_ENV')
  },
  get LOG_LEVEL() {
    return getEnv('LOG_LEVEL', { default: 'info' })
  },
  get BUILD_NO() {
    // next.config.ts の env で注入する値は Next.js が静的な process.env.BUILD_NO を
    // ビルド時にインライン化するため、getEnv（動的アクセス）ではなく静的参照で読む
    return process.env.BUILD_NO ?? 'unknown'
  },
  get DATABASE_URL() {
    return getEnv('DATABASE_URL', { required: true })
  },
  get DEFAULT_LOCALE() {
    return getEnv('DEFAULT_LOCALE')
  },
  /**
   * サーバー側の判定(エージェントの稼働時間帯・処理上限のリセット、期限間近の判定など)で、
   * 利用者やランナーにタイムゾーンが設定されていないときに使う
   */
  get DEFAULT_TIMEZONE() {
    const value = getEnv('DEFAULT_TIMEZONE', { default: 'Asia/Tokyo' }).trim()
    if (!isValidTimezone(value)) {
      throw errSystemError('DEFAULT_TIMEZONE must be an IANA time zone name')
    }
    return value
  },
  /**
   * 検索エンジンにインデックスさせるか。既定の false では meta robots / X-Robots-Tag が
   * インデックス拒否になる。検索結果へ載せたい場合だけ true にする。
   * robots.txt は SEARCH_ENGINE_ROBOTS_ALLOW と合わせて決まる。
   */
  get SEARCH_ENGINE_INDEXING() {
    return getEnvBoolean('SEARCH_ENGINE_INDEXING')
  },
  /**
   * robots.txt でクロールを許可するか。
   * SEARCH_ENGINE_INDEXING=false のまま true にすると、クロールさせた上で noindex を読ませられる。
   */
  get SEARCH_ENGINE_ROBOTS_ALLOW() {
    return getEnvBoolean('SEARCH_ENGINE_ROBOTS_ALLOW')
  },
  /**
   * ダッシュボードのリリースノートの取得元(GitHub の owner/repo)。
   * URL を丸ごと入れるとパスが壊れ、取得失敗として黙って空表示になるため形式を確かめる。
   */
  get RELEASE_NOTES_REPO() {
    const value = getEnv('RELEASE_NOTES_REPO', { default: 'playree/devuntu' }).trim()
    if (!/^[\w.-]+\/[\w.-]+$/.test(value) || value.split('/').some((s) => s === '.' || s === '..')) {
      throw errSystemError('RELEASE_NOTES_REPO must be owner/repo')
    }
    return value
  },
  /**
   * リリースノートの最大取得件数。
   * GitHub API の per_page は100が上限で、超えた値は黙って100に丸められる。
   */
  get RELEASE_NOTES_LIMIT() {
    return getEnvInt('RELEASE_NOTES_LIMIT', { default: 20, min: 1, max: 100 })
  },

  // 認証
  get BETTER_AUTH_SECRET() {
    return getEnv('BETTER_AUTH_SECRET', { required: true })
  },
  get BETTER_AUTH_URL() {
    return getEnv('BETTER_AUTH_URL', { required: true })
  },
  get SESSION_EXPIRES_IN() {
    return getEnvInt('SESSION_EXPIRES_IN', { default: 60 * 60 * 24 * 5, min: 1 })
  },
  get SESSION_FRESH_AGE() {
    return getEnvInt('SESSION_FRESH_AGE', { default: 60 * 60 * 24, min: 0 })
  },
  /** MCP用リフレッシュトークンの有効期限(秒)。Webログインセッションとは独立 */
  get MCP_REFRESH_TOKEN_EXPIRES_IN() {
    return getEnvInt('MCP_REFRESH_TOKEN_EXPIRES_IN', { default: 60 * 60 * 24 * 180, min: 1 })
  },
  get TWO_FA_REQUIRED() {
    return getEnvBoolean('TWO_FA_REQUIRED', { default: true })
  },
  get DISABLE_PASSWORD_AUTH() {
    return getEnvBoolean('DISABLE_PASSWORD_AUTH')
  },
  /** 動的クライアント登録(RFC 7591)を有効にする。MCP クライアントの接続に必要 */
  get OIDC_DCR_ENABLED() {
    return getEnvBoolean('OIDC_DCR_ENABLED')
  },
  get MAIN_DEVUNTU_URL() {
    return getEnv('MAIN_DEVUNTU_URL')
  },
  get MAIN_DEVUNTU_CLIENT_ID() {
    return getEnv('MAIN_DEVUNTU_CLIENT_ID')
  },
  get MAIN_DEVUNTU_CLIENT_SECRET() {
    return getEnv('MAIN_DEVUNTU_CLIENT_SECRET')
  },
  get GOOGLE_CLIENT_ID() {
    return getEnv('GOOGLE_CLIENT_ID')
  },
  get GOOGLE_CLIENT_SECRET() {
    return getEnv('GOOGLE_CLIENT_SECRET')
  },
  get SLACK_CLIENT_ID() {
    return getEnv('SLACK_CLIENT_ID')
  },
  get SLACK_CLIENT_SECRET() {
    return getEnv('SLACK_CLIENT_SECRET')
  },
  get SLACK_BOT_TOKEN() {
    return getEnv('SLACK_BOT_TOKEN')
  },
  get SLACK_TEAM_ID() {
    return getEnv('SLACK_TEAM_ID')
  },
  get SLACK_SIGNING_SECRET() {
    return getEnv('SLACK_SIGNING_SECRET')
  },
  /** GitHub Webhook の署名シークレット。未設定なら GitHub 連携ごと無効 */
  get GITHUB_WEBHOOK_SECRET() {
    return getEnv('GITHUB_WEBHOOK_SECRET')
  },
  get GOOGLE_ALLOWED_DOMAINS() {
    const domains = getEnv('GOOGLE_ALLOWED_DOMAINS')
    return domains ? domains.split(',') : []
  },

  // 通知
  /**
   * 通知の配信ワーカー(`notify-worker.ts`)を動かすか。
   * 止めるとキューへの投入だけが続き、配信は行われない(切り分け用)。
   */
  get NOTIFY_WORKER_ENABLED() {
    return getEnvBoolean('NOTIFY_WORKER_ENABLED', { default: true })
  },

  /**
   * Web プッシュの VAPID 鍵(P-256, base64url)。
   *
   * NOTE: 公開鍵も `NEXT_PUBLIC_*` にはできない。配布物は事前ビルド済みのイメージで、
   * `NEXT_PUBLIC_*` はビルド時にインライン化されるため起動時に渡した値が入らない。
   * 購読の登録では Server Action(`getWebPushPublicKey`)で実行時に返す。
   */
  get VAPID_PUBLIC_KEY() {
    return getEnv('VAPID_PUBLIC_KEY')
  },
  get VAPID_PRIVATE_KEY() {
    return getEnv('VAPID_PRIVATE_KEY')
  },
  /** VAPID の `sub`。プッシュサービスからの連絡先(`mailto:` / `https:`)。既定は送信元アドレス */
  get VAPID_SUBJECT() {
    return getEnv('VAPID_SUBJECT') ?? `mailto:${getEnv('MAIL_FROM', { default: 'devuntu@example.com' })}`
  },

  // メンテナンス
  /**
   * メンテナンスモードのフラグファイル。**存在すれば遮断中**として扱う。
   *
   * DB に持たないのは、DB リストア中でも遮断が効いている必要があるため。
   * 切り替えは `scripts/maintenance.mjs` 側で行い、こちらは読むだけ。
   *
   * 既定値を cwd 相対にしているのは、切り替える側(`scripts/maintenance.mjs` の既定も cwd 相対)と
   * 同じファイルを指させるため。Docker では `WORKDIR /app` なので `/app/config/maintenance` になり、
   * clone した環境ではリポジトリ直下の `config/maintenance` になる。
   * `COMMAND_DEF_DIR` のような絶対パス固定にすると、後者で両者が食い違い遮断できない。
   */
  get MAINTENANCE_MODE_FILE() {
    // node:path は import しない(クライアント用バンドルへ node 組み込みを持ち込まないため)
    return getEnv('MAINTENANCE_MODE_FILE', { default: `${process.cwd()}/config/maintenance` })
  },

  /**
   * 定期メンテナンス(`maintenance-worker.ts`)を動かすか。
   * 止めると期限切れ行の掃除が行われなくなるだけで、アプリの動作には影響しない。
   */
  get MAINTENANCE_WORKER_ENABLED() {
    return getEnvBoolean('MAINTENANCE_WORKER_ENABLED', { default: true })
  },

  /**
   * どの本文からも参照されていない添付の扱い。
   *
   * 掃除の中で唯一の不可逆操作(オブジェクトストレージからの削除)なので、
   * `dry-run` で対象をログに出して確かめてから `delete` へ切り替えられるようにしている。
   */
  get MAINTENANCE_ATTACHMENT_MODE() {
    const value = getEnv<'off' | 'dry-run' | 'delete'>('MAINTENANCE_ATTACHMENT_MODE', { default: 'delete' })
    // 綴り違いを黙って `delete` 相当として扱うと、止めたつもりで実体が消える
    if (value !== 'off' && value !== 'dry-run' && value !== 'delete') {
      throw errSystemError('MAINTENANCE_ATTACHMENT_MODE must be off, dry-run or delete')
    }
    return value
  },

  /**
   * アップロードから削除対象になるまでの猶予(時間)。
   *
   * 添付は本文の保存より先に作られるため、作成フォームを開いたまま放置している間は
   * まだどこからも参照されていない。その間に消さないための幅。
   */
  get MAINTENANCE_ATTACHMENT_GRACE_HOURS() {
    return getEnvInt('MAINTENANCE_ATTACHMENT_GRACE_HOURS', { default: 24, min: 1 })
  },

  /** エージェントの実行履歴を残す期間(日) */
  get AGENT_RUN_RETENTION_DAYS() {
    return getEnvInt('AGENT_RUN_RETENTION_DAYS', { default: 90, min: 1, max: MAX_RETENTION_DAYS })
  },

  /**
   * ランナー1台あたりに残す実行履歴の上限。期間内に積み上がった分への歯止め。
   *
   * 画面が出せる件数(`AGENT_RUN_HISTORY_LIMIT`)を下回ると「一覧に出ているのに実体が無い」
   * 履歴が生まれるため、そこを下限にする。
   */
  get AGENT_RUN_KEEP() {
    return getEnvInt('AGENT_RUN_KEEP', { default: 500, min: AGENT_RUN_HISTORY_LIMIT })
  },

  // リモート実行
  /**
   * 画面からのリモート実行を有効にするか。
   *
   * 既定を false にしているのは、この機能が「サーバーから対象ホストへ SSH してプロセスを起動する」
   * という他に無い性質を持つため。定義ファイルを置いただけでも、環境変数を入れただけでも動かない。
   */
  get COMMAND_EXEC_ENABLED() {
    return getEnvBoolean('COMMAND_EXEC_ENABLED')
  },

  /**
   * コマンド定義(YAML)を置くディレクトリ。運用者が read-only でマウントする。
   *
   * 直下の `*.yaml` / `*.yml` が対象で、1 ファイルに 1 ホストを書く。
   * ファイルパスではなくディレクトリを指す。
   */
  get COMMAND_DEF_DIR() {
    return getEnv('COMMAND_DEF_DIR', { default: '/app/config/commands' })
  },

  /**
   * SSH の秘密鍵と known_hosts を置くディレクトリ。
   *
   * 定義ファイルからはこの配下の**ファイル名**しか指定できない。
   * 鍵そのものは DB に持たず、read-only のバインドマウントで渡す。
   */
  get COMMAND_SSH_DIR() {
    return getEnv('COMMAND_SSH_DIR', { default: '/app/config/ssh' })
  },

  /** ssh の子プロセスへ引き継ぐ PATH / HOME。アプリの環境変数は丸ごとは渡さない */
  get COMMAND_SSH_PATH() {
    return getEnv('PATH', { default: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' })
  },
  get COMMAND_SSH_HOME() {
    return getEnv('HOME', { default: '/tmp' })
  },

  /**
   * known_hosts のパス(ホストごとの指定が無い場合の既定)。
   *
   * StrictHostKeyChecking=yes と組み合わせるため、ここが無いホストへは接続できない(fail closed)。
   */
  get COMMAND_SSH_KNOWN_HOSTS() {
    return (
      getEnv('COMMAND_SSH_KNOWN_HOSTS') ?? `${getEnv('COMMAND_SSH_DIR', { default: '/app/config/ssh' })}/known_hosts`
    )
  },

  /**
   * 実行ワーカー(`command-worker.ts`)を動かすか。
   * 止めると待ち行列に積まれるだけで実行されない(切り分け用)。
   */
  get COMMAND_WORKER_ENABLED() {
    return getEnvBoolean('COMMAND_WORKER_ENABLED', { default: true })
  },

  /**
   * 同時に走らせる実行の上限。
   *
   * サーバーから対象ホストへ SSH を張る数がそのままこの値になるので、控えめな既定にしてある。
   */
  get COMMAND_MAX_CONCURRENT() {
    return getEnvInt('COMMAND_MAX_CONCURRENT', { default: 2, min: 1 })
  },

  /** 順番待ちに積める実行の上限。これを超える投入は拒否する */
  get COMMAND_MAX_QUEUED() {
    return getEnvInt('COMMAND_MAX_QUEUED', { default: 20, min: 1 })
  },

  /** コマンドの実行履歴を残す期間(日) */
  get COMMAND_RUN_RETENTION_DAYS() {
    return getEnvInt('COMMAND_RUN_RETENTION_DAYS', { default: 90, min: 1, max: MAX_RETENTION_DAYS })
  },

  /**
   * コマンド1本あたりに残す実行履歴の上限。期間内に積み上がった分への歯止め。
   *
   * ログ(`command_run_chunk`)は実行1件あたり数千行になりうるので、
   * エージェントの実行履歴(`AGENT_RUN_KEEP`)より絞った既定にしてある。
   */
  get COMMAND_RUN_KEEP() {
    return getEnvInt('COMMAND_RUN_KEEP', { default: 300, min: 1 })
  },

  // メール
  get MAIL_SEND() {
    return getEnv<'sendgrid' | 'sendmail' | 'smtp' | 'debug'>('MAIL_SEND')
  },
  get MAIL_FROM() {
    return getEnv('MAIL_FROM', { required: true })
  },
  get SENDGRID_API_KEY() {
    return getEnv('SENDGRID_API_KEY', { required: true })
  },
  get SENDMAIL_PATH() {
    return getEnv('SENDMAIL_PATH', { required: true })
  },
  get SMTP_HOST() {
    return getEnv('SMTP_HOST', { required: true })
  },
  get SMTP_PORT() {
    return getEnvInt('SMTP_PORT', { required: true, min: 1, max: 65535 })
  },
  get SMTP_IGNORE_TLS() {
    return getEnvBoolean('SMTP_IGNORE_TLS')
  },
  get SMTP_SECURE() {
    return getEnvBoolean('SMTP_SECURE')
  },
  get SMTP_USER() {
    return getEnv('SMTP_USER')
  },
  get SMTP_PASS() {
    return getEnv('SMTP_PASS')
  },

  // オブジェクトストレージ(S3互換)
  get S3_ENDPOINT() {
    return getEnv('S3_ENDPOINT', { required: true })
  },
  get S3_BUCKET() {
    return getEnv('S3_BUCKET', { default: 'devuntu' })
  },
  get S3_REGION() {
    return getEnv('S3_REGION', { default: 'us-east-1' })
  },
  get S3_ACCESS_KEY_ID() {
    return getEnv('S3_ACCESS_KEY_ID', { required: true })
  },
  get S3_SECRET_ACCESS_KEY() {
    return getEnv('S3_SECRET_ACCESS_KEY', { required: true })
  },
  get S3_FORCE_PATH_STYLE() {
    // SeaweedFS などはバーチャルホスト形式に対応しないためデフォルトで有効
    return getEnvBoolean('S3_FORCE_PATH_STYLE', { default: true })
  },

  // Linode
  get LINODE_ID() {
    return getEnv('LINODE_ID')
  },
  get LINODE_PERSONAL_ACCESS_TOKEN() {
    return getEnv('LINODE_PERSONAL_ACCESS_TOKEN')
  },

  // Debug
  get DEBUG_LINODE_DUMMY() {
    const value = getEnv('DEBUG_LINODE_DUMMY')
    if (!value) {
      return undefined
    }

    try {
      return JSON.parse(value)
    } catch {
      throw errSystemError(`DEBUG_LINODE_DUMMY is not valid JSON: ${value}`)
    }
  },
}

export const envu = { client, server }
