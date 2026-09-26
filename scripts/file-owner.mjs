/**
 * 生成物の所有者を、ホスト側の実行ユーザーに揃える。
 *
 * tools サービスのコンテナは root で動き、compose.yaml のディレクトリを `/work` へマウントして書き込む。
 * そのままだとホストでは root 所有になり、実行ユーザーが整理(削除・世代管理)できない。
 * `/work` 自体の所有者 = compose.yaml を置いたユーザーとみなし、そこへ合わせる。
 */
import { lchownSync, lstatSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** `target` の所有者。取れなければ undefined */
export const ownerOf = (target) => {
  try {
    const s = statSync(target)
    return { uid: s.uid, gid: s.gid }
  } catch {
    return undefined
  }
}

/**
 * root で実行されているときだけ、`paths` の所有者を `ref` の所有者に揃える。
 * 非root では他人の所有に変えられず、そもそも自分の所有で作られるので何もしない。
 *
 * 所有者を変えられなくてもバックアップ自体は成功しているため、失敗は無視する。
 *
 * @param {string[]} paths 対象のファイル/ディレクトリ
 * @param {{ recursive?: boolean, ref?: string }} [options] `recursive` でディレクトリ配下も対象にする
 */
export const matchOwner = (paths, { recursive = false, ref = process.cwd() } = {}) => {
  if (process.getuid?.() !== 0) {
    return
  }
  const owner = ownerOf(ref)
  if (!owner) {
    return
  }

  for (const target of paths) {
    const targets = [target]
    try {
      if (recursive && lstatSync(target).isDirectory()) {
        targets.push(...readdirSync(target, { recursive: true }).map((p) => path.join(target, p)))
      }
    } catch {
      continue
    }
    for (const p of targets) {
      try {
        lchownSync(p, owner.uid, owner.gid)
      } catch {
        // 無視する(上記)
      }
    }
  }
}
