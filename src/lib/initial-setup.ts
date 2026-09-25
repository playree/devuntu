/**
 * 初回セットアップの状態(サーバー専用)
 *
 * `'use server'` のファイルから export すると未認証で呼べるエンドポイントになるため、
 * Server Action ではなくここに置く。
 */

import { prisma, type Db } from './prisma'

/** ユーザーが1人でも居れば初回セットアップは済んでいる */
export const hasCompletedInitialSetup = async (db: Db = prisma) => (await db.user.count()) > 0
