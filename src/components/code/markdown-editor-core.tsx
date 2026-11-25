'use client'

import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { FC } from 'react'
import { CodeEditorCore, type CodeEditorCoreProps } from './code-editor-core'

/** Markdown の言語定義(先頭の front matter は YAML として色付けする)。language-data の定義から読み込み、本体とは別チャンクにする */
const loadMarkdown = async () => {
  const description = languages.find(({ name }) => name === 'Markdown')
  return description ? yamlFrontmatter({ content: await description.load() }) : []
}

/** Markdown のソースを編集する CodeMirror。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提 */
const MarkdownEditorCore: FC<Omit<CodeEditorCoreProps, 'language'>> = (props) => (
  <CodeEditorCore {...props} language={loadMarkdown} />
)

export default MarkdownEditorCore
