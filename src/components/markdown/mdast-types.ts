import type { isMdastHTMLNode } from '@mdxeditor/editor'

/** mdast のノード型。`@types/mdast` は直接の依存に無いため、MDXEditor の公開 API の引数から取り出す */
export type MdastNode = Parameters<typeof isMdastHTMLNode>[0]
