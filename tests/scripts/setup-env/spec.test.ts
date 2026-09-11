/**
 * 設定値の検証・生成の単体テスト
 *
 * 設定した本人が気づけない失敗(オリジン不一致、許可ドメイン空、真偽値の綴り違い)を
 * 入力の段階で弾けていることを確認する。
 */

import { describe, expect, it } from 'vitest'
import webpush from 'web-push'
import {
  ENV_DOCKER_SECTIONS,
  MANUAL_KEYS,
  buildDatabaseUrl,
  buildSeaweedS3Config,
  generatePassword,
  generateSecret,
  generateVapidKeys,
  isBundledDbUrl,
  isBundledS3Endpoint,
  mailRequiredKeys,
  parseDatabaseUrl,
  validateAllowedDomains,
  validateBetterAuthUrl,
  validateChoice,
  validateDatabaseUrl,
  validateMailFrom,
  validatePort,
  validatePositiveInt,
  validateTimezone,
  validateVapidSubject,
} from '../../../scripts/setup-env/spec.mjs'

describe('validateBetterAuthUrl', () => {
  it('末尾スラッシュを落として正規化する', () => {
    expect(validateBetterAuthUrl('https://devuntu.example.com/')).toMatchObject({
      ok: true,
      value: 'https://devuntu.example.com',
      normalized: true,
    })
  })

  it('パス・クエリ・フラグメントを含む入力を拒否する', () => {
    // オリジンが完全一致しないとサインインの POST が origin チェックで拒否される
    expect(validateBetterAuthUrl('https://x.example.com/app').error).toBeDefined()
    expect(validateBetterAuthUrl('https://x.example.com?a=1').error).toBeDefined()
    expect(validateBetterAuthUrl('https://x.example.com#a').error).toBeDefined()
  })

  it('URLでない入力と http/https 以外を拒否する', () => {
    expect(validateBetterAuthUrl('devuntu.example.com').error).toBeDefined()
    expect(validateBetterAuthUrl('ftp://x.example.com').error).toBeDefined()
    expect(validateBetterAuthUrl('').error).toBeDefined()
  })

  it('localhost 以外の http は通すが警告する', () => {
    expect(validateBetterAuthUrl('http://x.example.com').warn).toBeDefined()
    expect(validateBetterAuthUrl('http://localhost:3000').warn).toBeUndefined()
  })
})

describe('DATABASE_URL', () => {
  it('パスワードの特殊文字を percent-encoding して往復できる', () => {
    const url = buildDatabaseUrl({ user: 'devuser', password: 'p@ss#w/d', db: 'devuntu' })
    expect(url).toBe('postgresql://devuser:p%40ss%23w%2Fd@db:5432/devuntu?schema=public')
    expect(parseDatabaseUrl(url)).toMatchObject({ user: 'devuser', password: 'p@ss#w/d', db: 'devuntu' })
  })

  it('postgresql 以外のスキームと壊れた入力を拒否する', () => {
    expect(validateDatabaseUrl('mysql://u:p@h:3306/d').error).toBeDefined()
    expect(validateDatabaseUrl('not a url').error).toBeDefined()
    expect(validateDatabaseUrl('postgresql://u:p@h:5432/d')).toMatchObject({ ok: true })
  })

  it('DB名が無いURLを拒否する', () => {
    expect(parseDatabaseUrl('postgresql://u:p@h:5432/')).toBeUndefined()
  })
})

describe('同梱サービスの判定', () => {
  it('DATABASE_URL が同梱 db を指しているかを見る', () => {
    // 分岐の既定値に使う。固定で true にすると外部DBの既存設定が Enter で書き換わる
    expect(isBundledDbUrl('postgresql://u:p@db:5432/x?schema=public')).toBe(true)
    expect(isBundledDbUrl('postgresql://u:p@db/x')).toBe(true)
    expect(isBundledDbUrl('postgresql://u:p@db.example.com:5432/x')).toBe(false)
  })

  it('S3_ENDPOINT が同梱 SeaweedFS を指しているかを見る', () => {
    expect(isBundledS3Endpoint('http://s3:8333')).toBe(true)
    expect(isBundledS3Endpoint('https://s3.example.com')).toBe(false)
  })

  it('値が無い・壊れている場合は undefined を返す', () => {
    // 呼び出し側が ?? で既定値へ落とせるよう、false と区別する
    expect(isBundledDbUrl(undefined)).toBeUndefined()
    expect(isBundledDbUrl('')).toBeUndefined()
    expect(isBundledDbUrl('not a url')).toBeUndefined()
    expect(isBundledS3Endpoint(undefined)).toBeUndefined()
  })
})

describe('buildSeaweedS3Config', () => {
  it('既存の他のフィールドを保ったまま資格情報だけ差し替える', () => {
    const existing = {
      identities: [{ name: 'devuntu', credentials: [{ accessKey: 'old', secretKey: 'old' }], actions: ['Read'] }],
    }
    const result = buildSeaweedS3Config({ accessKey: 'ak', secretKey: 'sk' }, existing)
    expect(result.identities[0]).toMatchObject({ name: 'devuntu', actions: ['Read'] })
    expect(result.identities[0].credentials[0]).toEqual({ accessKey: 'ak', secretKey: 'sk' })
    // 引数の既存オブジェクトは書き換えない
    expect(existing.identities[0].credentials[0].accessKey).toBe('old')
  })

  it('既存が無ければ既定の identity を作る', () => {
    const result = buildSeaweedS3Config({ accessKey: 'ak', secretKey: 'sk' })
    expect(result.identities[0].credentials[0]).toEqual({ accessKey: 'ak', secretKey: 'sk' })
    expect(result.identities[0].actions).toContain('Write')
  })

  it('devuntu が先頭でなくても他の identity を壊さない', () => {
    // identities は複数持てるため、先頭決め打ちだと別 identity の資格情報を上書きしてしまう
    const existing = {
      identities: [
        { name: 'other', credentials: [{ accessKey: 'o-ak', secretKey: 'o-sk' }], actions: ['Read'] },
        { name: 'devuntu', credentials: [{ accessKey: 'old', secretKey: 'old' }], actions: ['Read', 'Write'] },
      ],
    }
    const result = buildSeaweedS3Config({ accessKey: 'ak', secretKey: 'sk' }, existing)
    expect(result.identities[0].credentials[0]).toEqual({ accessKey: 'o-ak', secretKey: 'o-sk' })
    expect(result.identities[1].credentials[0]).toEqual({ accessKey: 'ak', secretKey: 'sk' })
  })

  it('devuntu identity が無ければ既存を保ったまま追加する', () => {
    const existing = { identities: [{ name: 'other', credentials: [{ accessKey: 'o-ak', secretKey: 'o-sk' }] }] }
    const result = buildSeaweedS3Config({ accessKey: 'ak', secretKey: 'sk' }, existing)
    expect(result.identities).toHaveLength(2)
    expect(result.identities[0].name).toBe('other')
    expect(result.identities[1]).toMatchObject({ name: 'devuntu' })
    expect(result.identities[1].credentials[0]).toEqual({ accessKey: 'ak', secretKey: 'sk' })
  })
})

describe('検証結果の形状', () => {
  it('成功と失敗で同じ形を返す', () => {
    // TypeScript のテストから allowJs 経由で読むため、union になると .error / .warn が型エラーになる
    const okResult = validatePort('25')
    const ngResult = validatePort('0')
    expect(Object.keys(okResult).sort()).toEqual(Object.keys(ngResult).sort())
    expect(okResult).toMatchObject({ ok: true, value: '25', error: undefined })
    expect(ngResult).toMatchObject({ ok: false, value: '' })
    expect(ngResult.error).toBeDefined()
  })
})

describe('validateAllowedDomains', () => {
  it('trim と先頭 @ の除去をしてカンマ区切りへ戻す', () => {
    expect(validateAllowedDomains(' @a.example.com , b.example.jp ,')).toMatchObject({
      ok: true,
      value: 'a.example.com,b.example.jp',
    })
  })

  it('空は拒否する', () => {
    // 未設定だと許可ドメインが空になり、全ドメインのサインインが拒否される
    expect(validateAllowedDomains(' , ').error).toBeDefined()
  })

  it('ドメインとして読めない値を拒否する', () => {
    expect(validateAllowedDomains('example').error).toBeDefined()
  })
})

describe('その他の検証', () => {
  it('タイムゾーン名を検証する', () => {
    expect(validateTimezone('Asia/Tokyo')).toMatchObject({ ok: true })
    expect(validateTimezone('Asia/Nowhere').error).toBeDefined()
  })

  it('選択肢以外を拒否する', () => {
    const validate = validateChoice(['ja', 'en'])
    expect(validate('ja')).toMatchObject({ ok: true })
    expect(validate('jp').error).toBeDefined()
  })

  it('ポートは1〜65535の整数のみ', () => {
    expect(validatePort('25')).toMatchObject({ ok: true, value: '25' })
    expect(validatePort('0').error).toBeDefined()
    expect(validatePort('70000').error).toBeDefined()
    expect(validatePort('25.5').error).toBeDefined()
  })

  it('正の整数の下限を見る', () => {
    expect(validatePositiveInt(1)('1')).toMatchObject({ ok: true })
    expect(validatePositiveInt(1)('0').error).toBeDefined()
    expect(validatePositiveInt(1)('abc').error).toBeDefined()
  })

  it('下限0なら0を通す', () => {
    // SESSION_FRESH_AGE=0 は fresh チェック無効として扱われる有効な設定
    expect(validatePositiveInt(0)('0')).toMatchObject({ ok: true, value: '0' })
    expect(validatePositiveInt(0)('-1').error).toBeDefined()
  })

  it('送信元アドレスの形式を見る', () => {
    expect(validateMailFrom('devuntu@example.com')).toMatchObject({ ok: true })
    expect(validateMailFrom('devuntu').error).toBeDefined()
  })

  it('VAPIDの連絡先は mailto: / https: のみ', () => {
    expect(validateVapidSubject('mailto:devuntu@example.com')).toMatchObject({ ok: true })
    expect(validateVapidSubject('https://example.com')).toMatchObject({ ok: true })
    expect(validateVapidSubject('devuntu@example.com').error).toBeDefined()
  })
})

describe('MANUAL_KEYS', () => {
  it('すべて .env.docker のセクションに含まれる', () => {
    // 含まれていないと、引き継いだ値が「その他」セクションへ落ちてしまう
    const known = new Set(ENV_DOCKER_SECTIONS.flatMap((s) => s.keys))
    expect(MANUAL_KEYS.filter((key) => !known.has(key))).toEqual([])
  })
})

describe('mailRequiredKeys', () => {
  it('送信方式ごとに必須キーを返す', () => {
    expect(mailRequiredKeys('smtp')).toEqual(['MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT'])
    expect(mailRequiredKeys('sendgrid')).toEqual(['MAIL_FROM', 'SENDGRID_API_KEY'])
    expect(mailRequiredKeys('sendmail')).toEqual(['MAIL_FROM', 'SENDMAIL_PATH'])
    expect(mailRequiredKeys('debug')).toEqual(['MAIL_FROM'])
    expect(mailRequiredKeys('')).toEqual([])
  })
})

describe('自動生成', () => {
  it('パスワードは env と URL で安全な文字だけを使う', () => {
    // # はインラインコメント、@ : / は DATABASE_URL の区切りとして誤読される
    for (let i = 0; i < 20; i++) {
      expect(generatePassword()).toMatch(/^[A-Za-z0-9]{24}$/)
    }
  })

  it('シークレットは base64 32バイト', () => {
    expect(Buffer.from(generateSecret(), 'base64')).toHaveLength(32)
  })

  it('VAPID鍵は web-push が受理する形式で生成される', () => {
    // 配布イメージに web-push の実体が無いため node:crypto で作っている。互換性をここで担保する
    const { publicKey, privateKey } = generateVapidKeys()
    expect(publicKey).toHaveLength(87)
    expect(privateKey).toHaveLength(43)
    const raw = Buffer.from(publicKey, 'base64url')
    expect(raw).toHaveLength(65)
    expect(raw[0]).toBe(0x04)
    expect(Buffer.from(privateKey, 'base64url')).toHaveLength(32)
    expect(() => webpush.setVapidDetails('mailto:devuntu@example.com', publicKey, privateKey)).not.toThrow()
  })
})
