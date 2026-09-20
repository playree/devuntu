/**
 * SSH でのコマンド起動(サーバー専用)
 *
 * **このファイルがアプリ内で唯一 `child_process` に触る場所**。`command-exec.ts` は
 * `SshProcess` インタフェース越しにしか SSH を知らないので、テストではここだけを差し替える。
 *
 * `ssh2` ではなく OpenSSH の `ssh` を spawn しているのは、
 * - `output: 'standalone'` に native optional 依存を持ち込まない
 * - ホスト鍵の検証を OpenSSH に委譲できる(`ssh2` の `hostVerifier` は未指定だと全許可という危険な既定)
 * の 2 点による。詳細は `.plan/実装計画-サーバーサイドコマンド実行.md` を参照。
 */

import { spawn } from 'node:child_process'
import { type Readable } from 'node:stream'
import { logger } from '../logger'
import { type CommandTarget } from './command'
import { resolveKnownHostsPath, resolveSshFilePath } from './command-catalog'

export type SshExit = { code: number | null; signal: NodeJS.Signals | null }

export type SshProcess = {
  stdout: Readable
  stderr: Readable
  /** ssh の終了を待つ。起動自体に失敗した場合も解決する(code は null) */
  wait: () => Promise<SshExit>
  /** stdin を閉じる。リモート側の実行ゲートがある場合はこれが中断の合図になる */
  closeStdin: () => void
  kill: (signal: NodeJS.Signals) => void
}

export type SshTarget = {
  hostname: string
  port: number
  user: string
  /** 秘密鍵の絶対パス */
  identityFile: string
  /** このホスト用の known_hosts の絶対パス */
  knownHostsFile: string
}

/**
 * ssh に渡す引数を組み立てる。
 *
 * **純関数にしてあるのは、この並びをテストで丸ごと固定するため。**
 * `StrictHostKeyChecking=yes` や `BatchMode=yes` が 1 つでも落ちると、
 * 初回接続を自動で受け入れたり、パスワードを待って固まったりする。
 * 動作としては一見成立してしまうので、レビューでは気付きにくい。
 */
export const buildSshArgs = (target: SshTarget, remoteCommand: string): string[] => [
  // TTY を割り当てない。-tt にすると stdout と stderr が混ざり、進捗表示で区別できなくなる
  '-T',
  // パスフレーズやパスワードの入力待ちで固まらせない
  '-o',
  'BatchMode=yes',
  // agent が持つ別の鍵を勝手に試させない
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'IdentityAgent=none',
  // 初回接続でも自動で受け入れない。登録が無ければ接続に失敗する(fail closed)
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  `UserKnownHostsFile=${target.knownHostsFile}`,
  '-o',
  'GlobalKnownHostsFile=/dev/null',
  '-o',
  'PasswordAuthentication=no',
  '-o',
  'KbdInteractiveAuthentication=no',
  '-o',
  'ClearAllForwardings=yes',
  '-o',
  'ConnectTimeout=10',
  // 無音のまま切れた接続を検知する
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'LogLevel=ERROR',
  '-p',
  String(target.port),
  '-l',
  target.user,
  '-i',
  target.identityFile,
  // 以降をオプションとして解釈させない
  '--',
  target.hostname,
  remoteCommand,
]

/**
 * ホスト定義から接続先を解決する。
 *
 * 鍵か known_hosts のパスが解決できないターゲットは使えない。パスの検証は
 * `command-catalog.ts` 側(`COMMAND_SSH_DIR` の外を指していないか)で行う。
 */
export const resolveSshTarget = (target: CommandTarget): SshTarget | null => {
  const identityFile = resolveSshFilePath(target.identityFile)
  const knownHostsFile = resolveKnownHostsPath(target)
  if (!identityFile || !knownHostsFile) {
    logger.error({ targetId: target.id }, 'ssh target has no usable identity or known_hosts')
    return null
  }
  return { hostname: target.host, port: target.port, user: target.user, identityFile, knownHostsFile }
}

/**
 * ssh を起動する。
 *
 * `shell: false` なのでホスト名やオプションが引数へ混入する余地は無い。
 * リモート側は必ずログインシェルが `remoteCommand` を解釈するため、そちらの安全性は
 * `command-args.ts` の `shellQuote` が受け持つ。
 *
 * `env` をアプリの環境変数ごと渡すと、DB の接続文字列や秘密鍵が子プロセスから見えてしまう。
 * ssh の動作に要るものだけに絞る。
 */
export const spawnSshCommand = (target: SshTarget, remoteCommand: string): SshProcess => {
  /**
   * アプリの環境変数ごと渡すと DB の接続文字列などが子プロセスから見えてしまうので、
   * ssh の動作に要るものだけへ絞る。型は `NEXT_PUBLIC_*` などを含む形に拡張されているため、
   * ここだけ明示的に絞り込んだ辞書として渡す。
   */
  const env = {
    PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'C.UTF-8',
  } as unknown as NodeJS.ProcessEnv

  const child = spawn('ssh', buildSshArgs(target, remoteCommand), {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'] as const,
    env,
  })

  const exit = new Promise<SshExit>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
    child.once('error', (error) => {
      // spawn 自体に失敗した場合(ssh が入っていない等)は close が来ないことがある
      logger.error({ error }, 'failed to spawn ssh')
      resolve({ code: null, signal: null })
    })
  })

  return {
    stdout: child.stdout,
    stderr: child.stderr,
    wait: () => exit,
    closeStdin: () => {
      // 既に閉じている場合の EPIPE で実行ごと落とさない
      child.stdin.end(() => {})
      child.stdin.on('error', () => {})
    },
    kill: (signal) => {
      try {
        child.kill(signal)
      } catch {
        // 既に終了している
      }
    },
  }
}
