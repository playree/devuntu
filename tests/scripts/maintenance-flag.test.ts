/**
 * メンテナンスモードのフラグファイルの場所を決める部分の単体テスト
 *
 * ここがずれると、アプリが見ているのとは別のファイルを作って遮断が効かなかったり、
 * full-backup --maintenance が解除し損ねたりする。
 */

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAINTENANCE_FILE, parseMaintenanceFile } from '../../scripts/maintenance-flag.mjs'

describe('parseMaintenanceFile', () => {
  it('指定が無ければ cwd 相対の config/maintenance', () => {
    expect(parseMaintenanceFile(['on'])).toBe(DEFAULT_MAINTENANCE_FILE)
    expect(DEFAULT_MAINTENANCE_FILE).toBe(path.join(process.cwd(), 'config', 'maintenance'))
  })

  it('--file の値を絶対パスにして返す', () => {
    expect(parseMaintenanceFile(['--maintenance', '--file', 'tmp/flag'])).toBe(path.resolve('tmp/flag'))
  })

  it('--file の値が無い、または次のオプションならエラー', () => {
    expect(() => parseMaintenanceFile(['--file'])).toThrow('--file')
    expect(() => parseMaintenanceFile(['--file', '--maintenance'])).toThrow('--file')
  })
})
