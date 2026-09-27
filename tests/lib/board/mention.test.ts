/**
 * メンションの抽出と入力補助(`board/mention.ts`)の単体テスト
 *
 * prisma を型のみ参照する純粋関数なので、DB を起動せずに検証できる。
 */

import {
  extractMentionEmails,
  filterMentionCandidates,
  findMentions,
  formatMentionSource,
  matchMentionTrigger,
  MENTION_CANDIDATE_LIMIT,
  MENTION_EMAIL_MAX,
  normalizeMentionText,
  resolveMentionUserIds,
  stripCodeSpans,
} from '@/lib/board/mention'
import { describe, expect, it } from 'vitest'

/* -------------------------------------------------------------------------------------------------
 * メンション
 * -----------------------------------------------------------------------------------------------*/

describe('stripCodeSpans / normalizeMentionText', () => {
  it('コードブロックとインラインコードを除去する', () => {
    expect(stripCodeSpans('a ```x``` b `y` c').includes('x')).toBe(false)
    expect(stripCodeSpans('a ```x``` b `y` c').includes('y')).toBe(false)
  })

  it('~~~ のフェンスも除去する', () => {
    expect(stripCodeSpans('a\n~~~\nx\n~~~\nb').includes('x')).toBe(false)
  })

  it('バッククォートを重ねたインラインコードも除去する', () => {
    expect(stripCodeSpans('a ``x`` b').includes('x')).toBe(false)
    expect(stripCodeSpans('a ``x`y`` b').includes('x')).toBe(false)
  })

  it('コード外のテキストは残す', () => {
    expect(stripCodeSpans('a `x` b ~~~\ny\n~~~ c')).toContain('a')
    expect(stripCodeSpans('a `x` b ~~~\ny\n~~~ c')).toContain('c')
  })

  it('全角・大文字小文字・前後空白を正規化する', () => {
    expect(normalizeMentionText(' ＴＡＲＯ ')).toBe('taro')
    expect(normalizeMentionText('Foo@Example.COM')).toBe('foo@example.com')
  })
})

describe('extractMentionEmails: 本文からメンションを抽出する', () => {
  /** 長さの境界を試すための、指定した長さちょうどのメールアドレス */
  const emailOfLength = (length: number) => `${'a'.repeat(length - '@ex.com'.length)}@ex.com`

  const cases: { label: string; input: string; expected: string[] }[] = [
    { label: '行頭のメンション', input: '@[taro@example.com]', expected: ['taro@example.com'] },
    { label: '文中のメンション', input: 'よろしく @[taro@example.com] です', expected: ['taro@example.com'] },
    {
      label: '連続したメンションを出現順に抽出する',
      input: '@[a@example.com]@[b@example.com]',
      expected: ['a@example.com', 'b@example.com'],
    },
    { label: '2 行目の行頭', input: '一行目\n@[taro@example.com]', expected: ['taro@example.com'] },
    { label: '読点が続いても終端できる', input: '@[taro@example.com]、次に', expected: ['taro@example.com'] },
    { label: '括弧で囲まれていてもよい', input: '(@[taro@example.com])', expected: ['taro@example.com'] },
    { label: '大文字は小文字に正規化する', input: '@[TARO@Example.COM]', expected: ['taro@example.com'] },
    {
      label: '重複は 1 件に畳む',
      input: '@[taro@example.com] と @[TARO@example.com]',
      expected: ['taro@example.com'],
    },
    {
      label: 'エスケープされた角括弧も拾う(エディタを通さず書かれた本文の保険)',
      input: '@\\[taro@example.com]',
      expected: ['taro@example.com'],
    },
    { label: '裸のメールアドレスは誤検知しない', input: 'foo@example.com へ連絡', expected: [] },
    { label: '直前が単語文字なら無視する', input: 'foo@[taro@example.com]', expected: [] },
    { label: '@ が連続する場合は無視する', input: '@@[taro@example.com]', expected: [] },
    { label: 'メールアドレスに見えない中身は拾わない', input: '@[太郎]', expected: [] },
    { label: 'ドメインにドットが無い中身は拾わない', input: '@[taro@example]', expected: [] },
    { label: 'コードブロック内は対象外', input: '```\n@[taro@example.com]\n```', expected: [] },
    { label: '~~~ のコードブロック内は対象外', input: '~~~\n@[taro@example.com]\n~~~', expected: [] },
    { label: 'インラインコード内は対象外', input: '`@[taro@example.com]`', expected: [] },
    { label: 'バッククォートを重ねたインラインコード内も対象外', input: '``@[taro@example.com]``', expected: [] },
    { label: '@ 単体は 0 件', input: '@', expected: [] },
    { label: '空文字は 0 件', input: '', expected: [] },
    {
      label: '最大長ちょうどは抽出する',
      input: `@[${emailOfLength(MENTION_EMAIL_MAX)}]`,
      expected: [emailOfLength(MENTION_EMAIL_MAX)],
    },
    { label: '最大長超過は抽出しない', input: `@[${emailOfLength(MENTION_EMAIL_MAX + 1)}]`, expected: [] },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(extractMentionEmails(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }
})

describe('findMentions: 記法の位置も返す(表示用ノードへの差し替えに使う)', () => {
  it('記法全体の範囲を指す', () => {
    const text = 'よろしく @[taro@example.com] です'
    const [match] = findMentions(text)
    expect(text.slice(match.index, match.index + match.length)).toBe('@[taro@example.com]')
    expect(match.email).toBe('taro@example.com')
  })

  it('重複したメンションも畳まずすべて返す', () => {
    expect(findMentions('@[a@ex.com] @[a@ex.com]').length, '本文中の見た目はどちらも置き換える').toBe(2)
  })
})

describe('resolveMentionUserIds: メールアドレスを userId へ解決する', () => {
  const candidates = [
    { id: 'u1', email: 'taro@example.com' },
    { id: 'u2', email: 'hanako@example.com' },
  ]

  it('候補に一致すれば解決する', () => {
    expect(resolveMentionUserIds(['taro@example.com'], candidates)).toEqual(['u1'])
  })

  it('候補に無いメールアドレスは解決しない', () => {
    expect(resolveMentionUserIds(['jiro@example.com'], candidates)).toEqual([])
  })

  it('表示名が同じユーザーでもそれぞれ解決できる', () => {
    const sameName = [
      { id: 'u1', email: 'taro@example.com' },
      { id: 'u2', email: 'taro@other.com' },
    ]
    expect(resolveMentionUserIds(['taro@example.com', 'taro@other.com'], sameName)).toEqual(['u1', 'u2'])
  })

  it('大文字小文字の差異を吸収して一致する', () => {
    expect(resolveMentionUserIds(['TARO@Example.com'], candidates)).toEqual(['u1'])
  })

  it('候補が空なら 0 件', () => {
    expect(resolveMentionUserIds(['taro@example.com'], [])).toEqual([])
  })

  it('抽出順を保ち、同一 userId は 1 回だけ返す', () => {
    expect(resolveMentionUserIds(['hanako@example.com', 'taro@example.com', 'HANAKO@example.com'], candidates)).toEqual(
      ['u2', 'u1'],
    )
  })
})

/* -------------------------------------------------------------------------------------------------
 * メンションの入力補助
 * -----------------------------------------------------------------------------------------------*/

describe('matchMentionTrigger: キャレット直前の入力中メンションを捉える', () => {
  const cases: { label: string; input: string; expected: ReturnType<typeof matchMentionTrigger> }[] = [
    {
      label: '@ 単体でも一致する(直後に一覧を出すため)',
      input: '@',
      expected: { leadOffset: 0, matchingString: '', replaceableString: '@' },
    },
    {
      label: '行頭のクエリ',
      input: '@太',
      expected: { leadOffset: 0, matchingString: '太', replaceableString: '@太' },
    },
    {
      label: '空白の後のクエリ',
      input: 'よろしく @tar',
      expected: { leadOffset: 5, matchingString: 'tar', replaceableString: '@tar' },
    },
    {
      label: '空白なしの日本語文中でも一致する(@ の直前が単語文字でない)',
      input: '見て@やま',
      expected: { leadOffset: 2, matchingString: 'やま', replaceableString: '@やま' },
    },
    {
      label: '改行の後のクエリ',
      input: '一行目\n@太',
      expected: { leadOffset: 4, matchingString: '太', replaceableString: '@太' },
    },
    {
      label: 'メールアドレスの途中でも一致する(候補の絞り込みに使う)',
      input: '@taro.yamada@exa',
      expected: { leadOffset: 0, matchingString: 'taro.yamada@exa', replaceableString: '@taro.yamada@exa' },
    },
    {
      label: '句読点はクエリに含める(候補が無ければ一覧は出ない)',
      input: '@太郎。',
      expected: { leadOffset: 0, matchingString: '太郎。', replaceableString: '@太郎。' },
    },
    { label: '直前が単語文字ならメールアドレスとみなして一致しない', input: 'foo@exa', expected: null },
    { label: '@ が連続する場合は一致しない', input: '@@太', expected: null },
    { label: '空白でクエリが終端するので一致しない', input: '@太郎 ', expected: null },
    { label: '角括弧はクエリに使えない', input: '@[', expected: null },
    { label: 'メンションを含まない文字列', input: 'よろしく', expected: null },
    { label: '空文字', input: '', expected: null },
    {
      label: '最大長ちょうどのクエリは一致する',
      input: `@${'a'.repeat(MENTION_EMAIL_MAX)}`,
      expected: {
        leadOffset: 0,
        matchingString: 'a'.repeat(MENTION_EMAIL_MAX),
        replaceableString: `@${'a'.repeat(MENTION_EMAIL_MAX)}`,
      },
    },
    { label: '最大長を超えたクエリは一致しない', input: `@${'a'.repeat(MENTION_EMAIL_MAX + 1)}`, expected: null },
  ]

  for (const { label, input, expected } of cases) {
    it(label, () => {
      expect(matchMentionTrigger(input), `入力: ${JSON.stringify(input)}`).toEqual(expected)
    })
  }

  it('leadOffset は @ の位置を指す', () => {
    const input = 'よろしく @tar'
    const match = matchMentionTrigger(input)
    expect(input.slice(match?.leadOffset), 'leadOffset から末尾までが置換対象と一致する').toBe(match?.replaceableString)
  })
})

describe('formatMentionSource: 書き出した記法が extractMentionEmails で復元できる', () => {
  const emails = ['taro@example.com', 'taro.yamada+tag@example.co.jp', 'a@b.cd']

  for (const email of emails) {
    it(`往復する: ${email}`, () => {
      const source = formatMentionSource(email)
      expect(extractMentionEmails(source), `書き出し結果: ${source}`).toEqual([email])
    })
  }

  it('角括弧で囲み、大文字は小文字に揃える', () => {
    expect(formatMentionSource('TARO@Example.com')).toBe('@[taro@example.com]')
  })

  it('文中へ書き出しても復元できる', () => {
    const body = `よろしく ${formatMentionSource('taro@example.com')} お願いします`
    expect(extractMentionEmails(body)).toEqual(['taro@example.com'])
  })
})

describe('filterMentionCandidates: 入力中のクエリで候補を絞り込む', () => {
  const candidates = [
    { id: 'u1', name: 'hanako', email: 'hanako@example.com' },
    { id: 'u2', name: 'taro', email: 'taro@example.com' },
    { id: 'u3', name: 'yamada taro', email: 'yamada@example.com' },
    { id: 'u4', name: '山田 太郎', email: 'taro.yamada@example.com' },
  ]

  it('クエリが空なら全件返す', () => {
    expect(filterMentionCandidates(candidates, '').map((c) => c.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('名前の前方一致・メールの前方一致・部分一致の順に寄せる', () => {
    expect(filterMentionCandidates(candidates, 'taro').map((c) => c.id)).toEqual(['u2', 'u4', 'u3'])
  })

  it('メールアドレスでも絞り込める', () => {
    expect(filterMentionCandidates(candidates, 'hanako@ex').map((c) => c.id)).toEqual(['u1'])
    expect(
      filterMentionCandidates(candidates, 'example.com').map((c) => c.id),
      '部分一致',
    ).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('全角・大文字小文字の差異を吸収する', () => {
    expect(filterMentionCandidates(candidates, 'ＴＡＲＯ').map((c) => c.id)).toEqual(['u2', 'u4', 'u3'])
    expect(filterMentionCandidates(candidates, '山田').map((c) => c.id)).toEqual(['u4'])
  })

  it('表示名が同じユーザーもどちらも候補に出す(メールアドレスで見分けられる)', () => {
    const sameName = [
      { id: 'u1', name: '山田 太郎', email: 'taro@example.com' },
      { id: 'u2', name: '山田 太郎', email: 'taro@other.com' },
    ]
    expect(filterMentionCandidates(sameName, '山田').map((c) => c.id)).toEqual(['u1', 'u2'])
  })

  it('一致しなければ 0 件', () => {
    expect(filterMentionCandidates(candidates, 'jiro')).toEqual([])
  })

  it('既定の上限で切る', () => {
    const many = Array.from({ length: MENTION_CANDIDATE_LIMIT + 5 }, (_, i) => ({
      id: `u${i}`,
      name: `user${i}`,
      email: `user${i}@example.com`,
    }))
    expect(filterMentionCandidates(many, '').length).toBe(MENTION_CANDIDATE_LIMIT)
    expect(filterMentionCandidates(many, '', 3).length).toBe(3)
  })

  it('渡した候補の余分な項目は保つ', () => {
    const withImage = [{ id: 'u1', name: 'taro', email: 'taro@example.com', image: 'https://example.com/a.png' }]
    expect(filterMentionCandidates(withImage, 'ta')[0].image).toBe('https://example.com/a.png')
  })
})
