/**
 * 通知の共通定義
 *
 * NOTE: このファイルはクライアント('use client')からも import されるため、
 * サーバー専用の処理は `notify-setting.ts`(設定の読み書き) や
 * `notify-mention.ts`(送信) に配置する。
 */

import type { NotifyEvent } from '@/generated/prisma/enums'
import { findMentions, stripCodeSpans } from './task'
import { truncate } from './text-util'

/** 通知イベントの種別。Prisma の enum と同じ並びで持つ(tests/lib/notify.test.ts で一致を固定する) */
export const NOTIFY_EVENTS = ['mention'] as const satisfies readonly NotifyEvent[]

/** 通知チャネル。UserNotifySetting の列名と一致させる */
export const NOTIFY_CHANNELS = ['email', 'slack'] as const
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]

/** 1回の通知で送る宛先の上限。暴走時に外部サービスを叩き続けないための歯止め */
export const MAX_NOTIFY_RECIPIENTS = 20

/** 通知に載せる本文抜粋の上限。Slack の section 上限(3000)には余裕を持って収まる長さにする */
export const NOTIFY_EXCERPT_MAX = 500

/** 画像 `![alt](url)` / リンク `[text](url)`。URL は通知では邪魔なのでラベルだけ残す */
const RE_IMAGE = /!\[([^\]]*)]\([^)]*\)/g
const RE_LINK = /\[([^\]]*)]\([^)]*\)/g

/** 生HTMLのタグ。利用者が打った `<` は書き出しで `\<` になるので、生のタグは HTML とみなしてよい */
const RE_HTML_TAG = /<\/?[a-zA-Z][^>]*>/g

/** 行頭の見出し / 引用 / リストのマーカー */
const RE_LINE_MARKER = /^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm

/**
 * 強調・打ち消しの記号。`_` 単体は snake_case を壊すので対象にしない。
 * エスケープされたもの(`\*`)は記号として書かれた文字なので、バックスラッシュごと後段へ残す。
 */
const RE_EMPHASIS = /(?<!\\)(?:\*\*|__|~~|\*)/g

/** Markdown のバックスラッシュエスケープ。CommonMark がエスケープを許す ASCII 記号だけを戻す */
const RE_BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g

/** HTML の文字参照。MDXEditor の書き出しは段落末尾の空白を `&#x20;` のような数値参照にする */
const RE_CHAR_REFERENCE = /&(#[Xx]([0-9A-Fa-f]+)|#(\d+)|([a-zA-Z]+));/g

/** 名前付き文字参照。書き出し側が出すのは数値参照だけなので、素で書かれうる分だけを持つ */
const NAMED_CHAR_REFERENCES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

/** 文字参照を実体へ戻す。読めない参照は元の表記のまま残す(壊れた文字にするより原文の方がまし) */
const decodeCharacterReferences = (text: string): string =>
  text.replace(RE_CHAR_REFERENCE, (matched, _body, hex: string, dec: string, name: string) => {
    if (name !== undefined) {
      return NAMED_CHAR_REFERENCES[name.toLowerCase()] ?? matched
    }
    const code = Number.parseInt(hex ?? dec, hex ? 16 : 10)
    // Unicode の範囲外・サロゲート単体・NUL は文字にできない(前者は fromCodePoint が投げる)
    if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return matched
    }
    return String.fromCodePoint(code)
  })

/**
 * メンション記法を `@表示名` へ置き換える。
 *
 * 画面(`mention-node.tsx`)と同じく、名前が引けなければメールアドレスをそのまま出す。
 * 記法の判定を {@link findMentions} に任せることで、本文中のメールアドレスの直後を
 * 拾わない前置ルールが通知側にも効く。
 */
const replaceMentions = (text: string, names: ReadonlyMap<string, string>): string => {
  let replaced = ''
  let rest = 0

  for (const { email, index, length } of findMentions(text)) {
    replaced += `${text.slice(rest, index)}@${names.get(email) ?? email}`
    rest = index + length
  }

  return replaced + text.slice(rest)
}

/**
 * 通知に載せるコメント本文の抜粋を作る。
 *
 * Markdown のまま送ると画像やリンクの URL が大半を占めてしまうため、記法を落として
 * 素のテキストへ均し、改行も畳んで 1 行にする(Slack の引用 1 行 / メールの 1 段落として出す)。
 * エスケープや文字参照も戻して、画面で見えているものへ寄せる。
 * 記法を完全に解釈するわけではなく、通知で読める程度に均すのが目的。
 */
export const commentExcerpt = (
  content: string,
  /** メンションの表示名。キーは {@link findMentions} が返す正規化済みのメールアドレス */
  mentionNames: ReadonlyMap<string, string> = new Map(),
  max: number = NOTIFY_EXCERPT_MAX,
): string => {
  // メンションを先に外す。`]` を残したままだとリンク記法として拾われうる
  const text = replaceMentions(stripCodeSpans(content), mentionNames)
    .replace(RE_IMAGE, '$1')
    .replace(RE_LINK, '$1')
    .replace(RE_HTML_TAG, '')
    .replace(RE_LINE_MARKER, '')
    .replace(RE_EMPHASIS, '')
    // 記法を落とし終えてから、記号として書かれた文字を戻す
    .replace(RE_BACKSLASH_ESCAPE, '$1')

  return truncate(decodeCharacterReferences(text).replace(/\s+/g, ' ').trim(), max)
}
