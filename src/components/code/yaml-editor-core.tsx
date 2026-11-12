'use client'

import { yaml } from '@codemirror/lang-yaml'
import { FC, useEffect, useRef, useState } from 'react'
import { CodeEditorCore } from './code-editor-core'
import { yamlLint, type EditorIssue } from './yaml-lint'

export type YamlEditorCoreProps = {
  /** 初回マウント時の内容。以後の変更は取り込まないので、外から入れ替えるときは key を変える */
  initialValue: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** 編集面の最小行数 */
  minRows?: number
  /**
   * 内容から指摘を作る。渡すと該当箇所へ印が付く。
   *
   * 組み込むかどうかは**初回マウント時に決まる**(拡張を差し替えると内容が巻き戻るため)。
   * 関数そのものは毎回読み直すので、後から中身が変わるぶんには追随する。
   */
  lint?: (value: string) => EditorIssue[]
}

/**
 * YAML の CodeMirror。ブラウザ専用なので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 * YAML はタブ文字を許さないので、インデントは半角スペース(CodeEditorCore の indentUnit)に任せる
 */
const YamlEditorCore: FC<YamlEditorCoreProps> = ({ lint, ...props }) => {
  // lint は初回マウント時に組み込みを決め、関数は最新を読む
  const lintRef = useRef(lint)
  useEffect(() => {
    lintRef.current = lint
  }, [lint])
  const [language] = useState(() => yaml())
  return (
    <CodeEditorCore
      {...props}
      aria-label='YAML'
      language={language}
      extensions={lint ? () => yamlLint(() => lintRef.current) : undefined}
    />
  )
}

export default YamlEditorCore
