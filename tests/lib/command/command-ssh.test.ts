/**
 * ssh の引数組み立ての単体テスト
 *
 * **この機能で最も価値の高い回帰テスト。**
 * `StrictHostKeyChecking=yes` や `BatchMode=yes` が落ちても動作としては一見成立してしまう
 * (初回接続を自動で受け入れる / パスワード待ちで固まる)ため、レビューでは気付けない。
 * 出力を丸ごと固定して、消えたら必ず落ちるようにしておく。
 */

import { buildSshArgs, type SshTarget } from '@/lib/command/command-ssh'
import { describe, expect, it } from 'vitest'

const target: SshTarget = {
  hostname: 'web01.internal',
  port: 2222,
  user: 'deploy',
  identityFile: '/app/config/ssh/ops_ed25519',
  knownHostsFile: '/app/config/ssh/known_hosts',
}

describe('buildSshArgs', () => {
  it('引数の並びを固定する', () => {
    expect(buildSshArgs(target, 'exec /opt/bin/deploy.sh')).toEqual([
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'IdentityAgent=none',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'UserKnownHostsFile=/app/config/ssh/known_hosts',
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
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'LogLevel=ERROR',
      '-p',
      '2222',
      '-l',
      'deploy',
      '-i',
      '/app/config/ssh/ops_ed25519',
      '--',
      'web01.internal',
      'exec /opt/bin/deploy.sh',
    ])
  })

  it.each([
    'BatchMode=yes',
    'IdentitiesOnly=yes',
    'StrictHostKeyChecking=yes',
    'GlobalKnownHostsFile=/dev/null',
    'PasswordAuthentication=no',
    'KbdInteractiveAuthentication=no',
  ])('安全側に倒す設定が必ず入る (%s)', (option) => {
    expect(buildSshArgs(target, 'true')).toContain(option)
  })

  it('ホスト名とコマンドは -- より後ろに置く', () => {
    // 前に置くと、ホスト名がハイフン始まりのときにオプションとして解釈されうる
    const args = buildSshArgs(target, 'true')
    const separator = args.indexOf('--')
    expect(separator).toBeGreaterThan(0)
    expect(args.indexOf('web01.internal')).toBeGreaterThan(separator)
    expect(args.indexOf('true')).toBeGreaterThan(separator)
  })

  it('TTY を割り当てない', () => {
    // -tt にすると stdout と stderr が混ざり、進捗表示で区別できなくなる
    const args = buildSshArgs(target, 'true')
    expect(args).toContain('-T')
    expect(args).not.toContain('-tt')
    expect(args).not.toContain('-t')
  })

  it('known_hosts はホストごとの指定を使う', () => {
    const other = buildSshArgs({ ...target, knownHostsFile: '/other/known_hosts' }, 'true')
    expect(other).toContain('UserKnownHostsFile=/other/known_hosts')
  })
})
