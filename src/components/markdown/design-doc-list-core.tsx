'use client'

/**
 * Markdown Design Doc Viewer の設計書一覧。ビューアと同じく大きいので `next/dynamic` の `ssr: false` 経由で読み込む前提。
 * viewer.css はカスケードレイヤーに入れない(design-doc-viewer-core.tsx と同じ)
 */
import 'markdown-design-doc-viewer-embed/viewer.css'

export { DesignDocList as default } from 'markdown-design-doc-viewer-embed/react'
