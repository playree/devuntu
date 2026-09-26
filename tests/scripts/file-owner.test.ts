/**
 * バックアップ等の生成物の所有者を揃える部分の単体テスト
 *
 * root でない実行(ローカルの pnpm full:backup など)で chown を試みたり、
 * 所有者を変えられないことでバックアップ自体を失敗させたりしないことを確認する。
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { matchOwner, ownerOf } from '../../scripts/file-owner.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'file-owner-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ownerOf', () => {
  it('存在するパスは uid / gid を返す', () => {
    const s = statSync(dir)
    expect(ownerOf(dir)).toEqual({ uid: s.uid, gid: s.gid })
  })

  it('存在しないパスは undefined', () => {
    expect(ownerOf(path.join(dir, 'missing'))).toBeUndefined()
  })
})

describe('matchOwner', () => {
  it('存在しないパスや参照先が混ざっても例外にしない', () => {
    const sub = path.join(dir, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    writeFileSync(path.join(sub, 'f'), 'x')

    expect(() => matchOwner([path.join(dir, 'missing'), dir], { recursive: true, ref: dir })).not.toThrow()
    expect(() => matchOwner([dir], { ref: path.join(dir, 'missing') })).not.toThrow()
  })

  it('配下の所有者は参照先と同じになる(root 以外では元々同じ)', () => {
    const file = path.join(dir, 'a', 'f')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'x')

    matchOwner([dir], { recursive: true, ref: dir })

    const expected = ownerOf(dir)
    expect(ownerOf(file)).toEqual(expected)
    expect(ownerOf(path.dirname(file))).toEqual(expected)
  })
})
