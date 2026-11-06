/** 参照の解決に必要なだけの mdast ノードの形(`@types/mdast` は直接の依存に無い) */
export type MdastLike = {
  type: string
  children?: MdastLike[]
  identifier?: string
  url?: string
  title?: string | null
}

export type ResolvedDefinition = { url: string; title: string | null }

const REFERENCE_TYPES: ReadonlySet<string> = new Set(['linkReference', 'imageReference'])

/**
 * mdast の木から参照リンク / 参照画像(`[text][x]` / `![alt][x]`)を集め、対応する定義(`[x]: url`)を引く。
 *
 * 定義は参照より後ろにも、引用やリストの中にも書けるため、木全体を先に走査する。
 * 同じ識別子の定義が複数あるときは CommonMark に従い最初のものを使う。
 * 識別子は mdast 側で正規化済み(大文字小文字・空白の違いを吸収済み)なので、そのまま比較してよい。
 * 定義が見つからない参照は結果に含めない。
 */
export const resolveMarkdownReferences = <N extends MdastLike>(root: N): Map<N, ResolvedDefinition> => {
  const definitions = new Map<string, ResolvedDefinition>()
  const references: N[] = []

  const walk = (node: N) => {
    if (node.type === 'definition' && node.identifier !== undefined && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, { url: node.url ?? '', title: node.title ?? null })
    } else if (REFERENCE_TYPES.has(node.type)) {
      references.push(node)
    }
    node.children?.forEach((child) => walk(child as N))
  }
  walk(root)

  const resolved = new Map<N, ResolvedDefinition>()
  for (const reference of references) {
    const definition = reference.identifier === undefined ? undefined : definitions.get(reference.identifier)
    if (definition) {
      resolved.set(reference, definition)
    }
  }
  return resolved
}
