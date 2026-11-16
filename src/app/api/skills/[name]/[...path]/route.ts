import { findAiSkillFile } from '@/lib/ai-skill'

/**
 * AI ツールのスキルのファイルを認証なしで配信する(`get_skill_install_guide` の手順が curl で取得する)。
 *
 * 中身は依存パッケージに同梱された公開物で秘密を含まないので、トークンを持たない curl でも取れるようにする。
 * メモリ上の定数を返すだけで DB にもストレージにも触れないため、レート制限は掛けない。
 */
export const GET = async (_req: Request, { params }: { params: Promise<{ name: string; path: string[] }> }) => {
  const { name, path } = await params
  const file = path.join('/')
  const content = findAiSkillFile(name, file)
  if (content === undefined) {
    return new Response(null, { status: 404 })
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
