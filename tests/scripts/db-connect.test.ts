/**
 * `DATABASE_URL` から libpq 用の接続情報を組み立てる部分の単体テスト
 *
 * ここを間違えると、バックアップとリストアで別のDBを相手にしたり、
 * Prisma 固有のクエリパラメータで接続そのものが失敗したりする。
 */

import { describe, expect, it } from 'vitest'
import { isBundledDbHost, resolveDbEnv } from '../../scripts/db-connect.mjs'

describe('resolveDbEnv', () => {
  it('接続URLを PG* へ分解する', () => {
    expect(resolveDbEnv('postgresql://devuser:secret@db:5432/devuntu')).toEqual({
      PGHOST: 'db',
      PGPORT: '5432',
      PGUSER: 'devuser',
      PGPASSWORD: 'secret',
      PGDATABASE: 'devuntu',
    })
  })

  it('Prisma 固有のクエリパラメータを渡さない', () => {
    // libpq は未知のパラメータをエラーにするため、URLをそのまま使ってはいけない
    const env = resolveDbEnv('postgresql://devuser:secret@db:5432/devuntu?schema=public&connection_limit=5')
    expect(env.PGDATABASE).toBe('devuntu')
    expect(Object.keys(env).every((key) => key.startsWith('PG'))).toBe(true)
    expect(env).not.toHaveProperty('PGSSLMODE')
  })

  it('sslmode は PGSSLMODE として引き継ぐ', () => {
    expect(resolveDbEnv('postgresql://devuser:secret@example.test/devuntu?sslmode=require').PGSSLMODE).toBe('require')
  })

  it('ポート省略時は 5432 になる', () => {
    expect(resolveDbEnv('postgresql://devuser:secret@db/devuntu').PGPORT).toBe('5432')
  })

  it('percent-encoding された値を復号する', () => {
    const env = resolveDbEnv('postgresql://dev%40user:p%40ss%3Aword@db:5432/my%20db')
    expect(env.PGUSER).toBe('dev@user')
    expect(env.PGPASSWORD).toBe('p@ss:word')
    expect(env.PGDATABASE).toBe('my db')
  })

  it('IPv6 の角括弧を外す', () => {
    expect(resolveDbEnv('postgresql://devuser:secret@[::1]:5432/devuntu').PGHOST).toBe('::1')
  })

  it('未設定・不正な値は例外にする', () => {
    expect(() => resolveDbEnv(undefined)).toThrow()
    expect(() => resolveDbEnv('not-a-url')).toThrow()
    expect(() => resolveDbEnv('postgresql://db:5432/devuntu')).toThrow()
  })
})

describe('isBundledDbHost', () => {
  it('同梱のdbサービスを指す接続先を受け入れる', () => {
    // compose ネットワーク内の `db` と、ホスト公開(127.0.0.1:5432)経由の loopback
    for (const url of [
      'postgresql://devuser:secret@db:5432/devuntu',
      'postgresql://devuser:secret@localhost:5432/devuntu',
      'postgresql://devuser:secret@127.0.0.1:5432/devuntu',
      'postgresql://devuser:secret@[::1]:5432/devuntu',
    ]) {
      expect(isBundledDbHost(resolveDbEnv(url))).toBe(true)
    }
  })

  it('外部のPostgreSQLは受け入れない', () => {
    // docker compose exec 経路へ倒すと、外部DBのつもりで同梱dbを操作してしまう
    for (const url of [
      'postgresql://devuser:secret@example.test:5432/devuntu',
      'postgresql://devuser:secret@10.0.0.5:5432/devuntu',
    ]) {
      expect(isBundledDbHost(resolveDbEnv(url))).toBe(false)
    }
  })
})
