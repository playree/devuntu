/**
 * リリース済み version の判定の単体テスト
 *
 * ここがずれると、リリース済みの version のまま PR や edge が通ったり、未リリースの version を上げてしまったりする。
 */

import { describe, expect, it } from 'vitest'
import {
  compareVersion,
  nextPatch,
  parseRemoteTags,
  passesCheck,
  releaseStatus,
  replaceVersion,
} from '../../scripts/release-version.mjs'

const LS_REMOTE = [
  'aaa\trefs/tags/stable',
  'bbb\trefs/tags/v0.9.3',
  'ccc\trefs/tags/v0.10.0',
  'ddd\trefs/tags/v1.0.0',
  'eee\trefs/tags/v1.0.0^{}',
  'aaa\trefs/tags/v1.0.1',
  'fff\trefs/tags/v1.0.1-rc.1',
  'ggg\trefs/tags/feature',
].join('\n')

describe('compareVersion / nextPatch', () => {
  it('各桁を数値で比較する', () => {
    expect(compareVersion('0.10.0', '0.9.3')).toBeGreaterThan(0)
    expect(compareVersion('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersion('1.0.1', '1.0.1')).toBe(0)
  })

  it('パッチだけを上げる', () => {
    expect(nextPatch('1.0.9')).toBe('1.0.10')
  })
})

describe('parseRemoteTags', () => {
  it('v<x.y.z> のタグだけを新しい順に拾い、注釈付きタグは指す先の commit を使う', () => {
    const { releases, stableSha } = parseRemoteTags(LS_REMOTE)
    expect(releases).toEqual([
      { version: '1.0.1', sha: 'aaa' },
      { version: '1.0.0', sha: 'eee' },
      { version: '0.10.0', sha: 'ccc' },
      { version: '0.9.3', sha: 'bbb' },
    ])
    expect(stableSha).toBe('aaa')
  })

  it('タグが無ければ空', () => {
    expect(parseRemoteTags('')).toEqual({ releases: [], stableSha: undefined })
  })
})

describe('releaseStatus', () => {
  const tags = parseRemoteTags(LS_REMOTE)

  it('リリース済みなら次のパッチを返す', () => {
    expect(releaseStatus('1.0.1', tags)).toEqual({
      version: '1.0.1',
      released: true,
      releasedSha: 'aaa',
      outdated: false,
      latest: '1.0.1',
      stable: '1.0.1',
      bumpTo: '1.0.2',
    })
  })

  it('未リリースで最新より新しければ上げない', () => {
    expect(releaseStatus('1.0.2', tags)).toMatchObject({ released: false, outdated: false, bumpTo: null })
    expect(releaseStatus('1.1.0', tags)).toMatchObject({ bumpTo: null })
  })

  it('最新リリースより古ければ、最新の次のパッチへ上げる', () => {
    expect(releaseStatus('0.9.4', tags)).toMatchObject({ released: false, outdated: true, bumpTo: '1.0.2' })
  })

  it('stable と同じ commit のタグが無ければ stable は null', () => {
    expect(releaseStatus('1.0.2', { ...tags, stableSha: 'zzz' }).stable).toBeNull()
  })

  it('リリースが1つも無ければ上げない', () => {
    expect(releaseStatus('0.1.0', parseRemoteTags(''))).toMatchObject({ latest: null, bumpTo: null })
  })

  it('x.y.z でない version はエラー', () => {
    expect(() => releaseStatus('1.0.2-rc.1', tags)).toThrow('x.y.z')
    expect(() => releaseStatus('1.0', tags)).toThrow('x.y.z')
  })
})

describe('passesCheck', () => {
  const tags = parseRemoteTags(LS_REMOTE)

  it('未リリースなら通す', () => {
    expect(passesCheck(releaseStatus('1.0.2', tags), undefined)).toBe(true)
  })

  it('リリース済みなら通さない', () => {
    expect(passesCheck(releaseStatus('1.0.1', tags), undefined)).toBe(false)
  })

  it('リリース済みでも、タグが指定の commit を指していれば通す', () => {
    expect(passesCheck(releaseStatus('1.0.1', tags), 'aaa')).toBe(true)
    expect(passesCheck(releaseStatus('1.0.1', tags), 'bbb')).toBe(false)
  })

  it('最新リリースより古い version は commit を指定しても通さない', () => {
    expect(passesCheck(releaseStatus('0.9.4', tags), 'bbb')).toBe(false)
  })
})

describe('replaceVersion', () => {
  it('"version" の値だけを書き換える', () => {
    const text = '{\n  "name": "devuntu",\n  "version": "1.0.1",\n  "dependencies": { "x": "1.0.1" }\n}\n'
    expect(replaceVersion(text, '1.0.2')).toBe(
      '{\n  "name": "devuntu",\n  "version": "1.0.2",\n  "dependencies": { "x": "1.0.1" }\n}\n',
    )
  })

  it('"version" が無ければエラー', () => {
    expect(() => replaceVersion('{}', '1.0.2')).toThrow('version')
  })
})
