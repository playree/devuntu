import { aiSkillRevision, findAiSkillFile } from '@/lib/ai-skill'

/**
 * AI ツールのスキルのファイルを認証なしで配信する(`get_skill_install_guide` の手順が curl で取得する)。
 *
 * 中身は依存パッケージに同梱された公開物で秘密を含まないので、トークンを持たない curl でも取れるようにする。
 * メモリ上の定数を返すだけで DB にもストレージにも触れないため、レート制限は掛けない。
 *
 * 手順は取得したときの revision を `?revision=` に付けて取得させる。今の版と違えば 409 にし、
 * 取得の途中でサーバーが更新されても違う版のファイルが混ざったスキルを入れさせない。
 */
export const GET = async (req: Request, { params }: { params: Promise<{ name: string; path: string[] }> }) => {
  const { name, path } = await params
  const file = path.join('/')
  const content = findAiSkillFile(name, file)
  if (content === undefined) {
    return new Response(null, { status: 404 })
  }
  const revision = String(aiSkillRevision(name))
  if (new URL(req.url).searchParams.get('revision') !== revision) {
    return new Response(`The skill on this server is at revision ${revision}. Get the install steps again.\n`, {
      status: 409,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  return new Response(content, {
    headers: {
      'Content-Type': `${file.endsWith('.md') ? 'text/markdown' : 'text/plain'}; charset=utf-8`,
      'X-Content-Type-Options': 'nosniff',
      // 依存パッケージを上げた直後に、キャッシュから前の版のファイルが混ざらないようにする
      'Cache-Control': 'no-cache',
    },
  })
}
