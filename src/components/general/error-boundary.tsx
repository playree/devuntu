'use client'

import { Component, ErrorInfo, ReactNode } from 'react'

type ErrorBoundaryProps = {
  fallback: ReactNode
  /** 値が変わると捕捉状態を解除して子を描画し直す */
  resetKey?: unknown
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  resetKey: unknown
}

/**
 * 子のレンダリングで投げられた例外を握りつぶして `fallback` に差し替える。
 * React の error boundary はクラスコンポーネントでしか実装できない。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, resetKey: props.resetKey }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    if (props.resetKey !== state.resetKey) {
      return { hasError: false, resetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
