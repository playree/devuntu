'use client'

/**
 * Markdown Design Doc Viewer の埋め込みビューア。ブラウザ専用で大きいので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 * スタイルもここでだけ読み込み、設計書を開かない画面にはチャンクも CSS も載せない。
 *
 * viewer.css はカスケードレイヤーに入れない(Tailwind の preflight が消すブラウザ既定の見た目を、レイヤー外から戻している)
 */
import 'markdown-design-doc-viewer-embed/viewer.css'

export { DesignDocViewer as default } from 'markdown-design-doc-viewer-embed/react'
