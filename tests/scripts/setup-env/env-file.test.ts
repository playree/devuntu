/**
 * env ファイルの読み書きの単体テスト
 *
 * `parseEnvFile` は Node の `util.parseEnv`(Stability 1.1)に委ねているため、
 * 受理してほしい書式をここでピン留めする。Node の更新で挙動が変わったときに、
 * 利用者の環境ではなくテストが落ちるようにするのが目的。
 */

import { describe, expect, it } from 'vitest'
import {
  diffEnv,
  isSecretKey,
  maskSecret,
  parseEnvFile,
  quoteEnvValue,
  serializeEnv,
} from '../../../scripts/setup-env/env-file.mjs'

describe('parseEnvFile', () => {
  it('インラインコメントを値に含めない', () => {
    expect(parseEnvFile('SESSION_EXPIRES_IN=172800 # 60*60*24*2')).toEqual({ SESSION_EXPIRES_IN: '172800' })
  })

  it('引用符の中の # はコメントにしない', () => {
    expect(parseEnvFile('A="a # b"')).toEqual({ A: 'a # b' })
    expect(parseEnvFile("A='a # b'")).toEqual({ A: 'a # b' })
  })

  it('空値・export 接頭辞・空白を含む値を受け取る', () => {
    expect(parseEnvFile('A=\nexport B=1\nC=a b c')).toEqual({ A: '', B: '1', C: 'a b c' })
  })

  it('同じキーは後の行が勝つ', () => {
    expect(parseEnvFile('A=1\nA=2')).toEqual({ A: '2' })
  })

  it('コメント行と空行を無視する', () => {
    expect(parseEnvFile('# comment\n\nA=1\n')).toEqual({ A: '1' })
  })
})

describe('quoteEnvValue', () => {
  it('曖昧にならない値は引用しない', () => {
    // base64 の +/= と URL、JSON は Compose と util.parseEnv のどちらも素のまま読める
    expect(quoteEnvValue('ab+c/d=')).toBe('ab+c/d=')
    expect(quoteEnvValue('postgresql://u:p@db:5432/x?schema=public')).toBe('postgresql://u:p@db:5432/x?schema=public')
    expect(quoteEnvValue('')).toBe('')
  })

  it('空白や # を含む値はシングルクォートで囲む', () => {
    expect(quoteEnvValue('a b')).toBe("'a b'")
    expect(quoteEnvValue('a#b')).toBe("'a#b'")
    expect(quoteEnvValue('a"b')).toBe("'a\"b'")
    // JSON は引用符を含むため囲むが、読み戻しは素の値に戻る
    expect(quoteEnvValue('{"used":1}')).toBe('\'{"used":1}\'')
  })

  it('$ を含む値を裸で出さない', () => {
    // godotenv は未引用の値へ補間をかけるため、PASS=pa$HOME はホストの $HOME へ化ける
    expect(quoteEnvValue('pa$HOME')).toBe("'pa$HOME'")
    expect(quoteEnvValue('a${B}c')).toBe("'a${B}c'")
    expect(parseEnvFile(`A=${quoteEnvValue('pa$HOME')}`)).toEqual({ A: 'pa$HOME' })
  })

  it('途中のバックスラッシュは許可する', () => {
    // godotenv も parseEnv も同じ値を返すので、過剰に弾かない
    expect(parseEnvFile(`A=${quoteEnvValue('pa\\ss')}`)).toEqual({ A: 'pa\\ss' })
    expect(parseEnvFile(`A=${quoteEnvValue('pa\\ss word')}`)).toEqual({ A: 'pa\\ss word' })
  })

  it('囲めない値は書き出さずエラーにする', () => {
    // ダブルクォートは Compose(godotenv)側で ${VAR} 補間とエスケープ解釈が起きるため使えない
    expect(() => quoteEnvValue("a'b c")).toThrow()
    expect(() => quoteEnvValue('a\nb')).toThrow()
    // 末尾のバックスラッシュは godotenv がクォートのエスケープと解釈し、env ファイル全体が読めなくなる
    expect(() => quoteEnvValue('pa\\')).toThrow()
    expect(() => quoteEnvValue('plain\\')).toThrow()
  })

  it('引用した値を parseEnvFile で読み戻せる', () => {
    const value = 'pass word#1'
    expect(parseEnvFile(`A=${quoteEnvValue(value)}`)).toEqual({ A: value })
  })
})

describe('serializeEnv', () => {
  const sections = [
    { title: '基本', keys: ['A', 'B'] },
    { title: '認証', keys: ['C'] },
  ]

  it('セクション順に出し、未設定のキーは行を出さない', () => {
    expect(serializeEnv({ sections, values: { A: '1', C: '3' } })).toBe('# 基本\nA=1\n\n# 認証\nC=3\n')
  })

  it('真偽値を true / false へ正規化する', () => {
    expect(serializeEnv({ sections, values: { A: true, B: false } })).toBe('# 基本\nA=true\nB=false\n')
  })

  it('値が無いセクションの見出しを出さない', () => {
    expect(serializeEnv({ sections, values: { A: '1' } })).toBe('# 基本\nA=1\n')
  })

  it('セクションに無いキーを末尾へ退避する', () => {
    expect(serializeEnv({ sections, values: { A: '1', MCP_ENABLED: 'true' }, extrasTitle: 'その他' })).toBe(
      '# 基本\nA=1\n\n# その他\nMCP_ENABLED=true\n',
    )
  })

  it('ヘッダをコメントとして先頭へ置く', () => {
    const header: string[] = ['説明', '2行目']
    expect(serializeEnv({ header, sections, values: { A: '1' } })).toBe('# 説明\n# 2行目\n\n# 基本\nA=1\n')
  })
})

describe('isSecretKey', () => {
  const managed = new Set(['BETTER_AUTH_URL', 'DEFAULT_LOCALE', 'POSTGRES_USER', 'SMTP_PASS'])

  it('列挙済みの秘密キーをマスクする', () => {
    expect(isSecretKey('SMTP_PASS', managed)).toBe(true)
  })

  it('既知の非秘密キーは素で出す', () => {
    expect(isSecretKey('BETTER_AUTH_URL', managed)).toBe(false)
    expect(isSecretKey('DEFAULT_LOCALE', managed)).toBe(false)
    expect(isSecretKey('POSTGRES_USER', managed)).toBe(false)
  })

  it('未知キーは一律マスクする', () => {
    // 列挙に頼ると MY_API_KEY のような独自のキーで平文が出てしまう
    expect(isSecretKey('MY_API_KEY', managed)).toBe(true)
    expect(isSecretKey('MCP_ENABLED', managed)).toBe(true)
  })

  it('秘密らしい名前は既知でもマスクする', () => {
    // 将来キーが増えたときの列挙漏れに備える
    expect(isSecretKey('NEW_SECRET', new Set(['NEW_SECRET']))).toBe(true)
    expect(isSecretKey('SOME_TOKEN', new Set(['SOME_TOKEN']))).toBe(true)
    expect(isSecretKey('DB_CREDENTIAL', new Set(['DB_CREDENTIAL']))).toBe(true)
  })
})

describe('maskSecret', () => {
  it('短い値は全体を隠す', () => {
    expect(maskSecret('abcd')).toBe('****')
    expect(maskSecret('')).toBe('')
  })

  it('長い値は前後3文字だけ残す', () => {
    expect(maskSecret('abcdefghij')).toBe('abc****hij')
  })
})

describe('diffEnv', () => {
  it('追加・変更・削除を分けて返す', () => {
    expect(diffEnv({ A: '1', B: '2' }, { A: '9', C: '3' })).toEqual({ added: ['C'], changed: ['A'], removed: ['B'] })
  })

  it('空文字への変更は削除として扱う', () => {
    expect(diffEnv({ A: '1' }, { A: '' })).toEqual({ added: [], changed: [], removed: ['A'] })
  })
})
