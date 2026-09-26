'use client'

import { notify } from '@/components/notify'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errClient, SYSTEM_ERROR, VALIDATION_ERROR } from '../error'
import { intervalOperation } from '../sleep'

type MarkDataResolved<T> = T & {
  data: NonNullable<T extends { data?: infer U } ? U : never>
}

/**
 * Server Action の戻りのうち、`parseAction` / `useActionData` が解釈できる最小形。
 * next-safe-action の `SafeActionFn` は型引数が多く補助型も export されていないため、
 * アクションを props で受け渡す場合はこの構造的な型で受ける。
 */
export type ActionResult<T> = {
  data?: T
  serverError?: { name?: string; errorType: string }
  validationErrors?: unknown
}

export function checkError<T extends { data?: unknown; serverError?: unknown; validationErrors?: unknown }>(
  res: T,
): asserts res is MarkDataResolved<T> {
  if (res.serverError || res.validationErrors) {
    throw new Error()
  }
}

/**
 * 失敗の通知を受け持つ関数。文言の翻訳や再認証の誘導にフックが要るため、
 * Providers 配下のコンポーネント(ActionErrorNotifier)が登録する。
 */
export type ActionErrorNotifier = (errorType: string) => void
let actionErrorNotifier: ActionErrorNotifier | undefined
export const setActionErrorNotifier = (notifier: ActionErrorNotifier | undefined) => {
  actionErrorNotifier = notifier
}
const notifyActionError = (errorType: string) => {
  if (actionErrorNotifier) {
    actionErrorNotifier(errorType)
  } else {
    notify.error('Error', { description: errorType })
  }
}

export type ParseActionOptions = {
  /** 実行が速すぎるときに待つ最小時間(ms)。ボタンのスピナーが一瞬で消えるのを防ぐ */
  wait?: number
  /**
   * 呼び出し側が自分で扱う ClientError の errorType。これらは通知せずに throw だけする。
   * 'all' はすべての ClientError を通知しない(取得系で、失敗を画面の表示で伝える場合など)。
   * システムエラー・入力検証エラーは常に通知する。
   */
  handled?: readonly string[] | 'all'
}

/**
 * Server Action の結果を解釈してデータを返す。
 * 失敗時(応答を受け取れなかった場合を含む)は通知(または再認証の誘導)をしてから throw する。ClientError は errorType 付きで throw するので、
 * 個別に扱う場合は `handled` に errorType を渡し、catch で `e.errorType` を見て分岐する。
 */
export const parseAction = async <
  T extends { data?: unknown; serverError?: { name?: string; errorType: string }; validationErrors?: unknown },
>(
  res: Promise<T>,
  { wait = 300, handled }: ParseActionOptions = {},
) => {
  const start = performance.now()
  let result: T
  try {
    result = await res
  } catch (e) {
    // 通信断などで応答自体を受け取れなかった
    console.error('action failed', e)
    notifyActionError(SYSTEM_ERROR)
    throw e
  }
  const execTime = ~~(performance.now() - start)
  console.debug('action exec', execTime)

  if (result.serverError?.name === 'ClientError') {
    const { errorType } = result.serverError
    console.debug(result.serverError)
    if (handled !== 'all' && !handled?.includes(errorType)) {
      notifyActionError(errorType)
    }
    throw errClient(errorType)
  }

  if (result.serverError || result.validationErrors) {
    console.error('action error', result.serverError || result.validationErrors)
    notifyActionError(result.serverError?.errorType ?? VALIDATION_ERROR)
    throw new Error()
  }

  if (wait - execTime > 0) {
    await intervalOperation(wait - execTime)
  }

  const data = result.data as T['data']
  if (data === undefined) {
    throw new Error()
  }

  return data
}

export type UseActionDataOptions = {
  /** true の間は取得しない。呼び出し元が値を持っている場合など */
  skip?: boolean
  /**
   * 取得対象を表す値。変わると取り直し、取り直すまでは前の key の data を返さない。
   * 対象を切り替えても古い結果が一瞬見えたり、後着で上書きしたりしないようにするためのもの
   */
  key?: string
}

/**
 * サーバーアクションをマウント時に実行し、結果を返す。
 * reload で再取得でき、isLoading で取得中かどうかを判定できる。
 * エラー時は data が undefined のまま。ClientError は通知しない(権限が無い等は呼び出し側が
 * data の有無で画面に出す)ため、通知するのはシステムエラーだけ。
 * action は毎レンダー再生成されるインライン関数でもよい(常に最新のものを呼ぶ)。
 * ただし action が参照する値の変化では自動再取得しないため、必要なら reload を呼ぶか key を渡す。
 *
 * refresh は isLoading を立てない再取得。表示を差し替えるだけで DOM を作り直したくない
 * (= ローディング表示に切り替えたくない)保存後の再取得に使う。
 */
export const useActionData = <T>(
  action: () => Promise<ActionResult<T>>,
  { skip = false, key }: UseActionDataOptions = {},
) => {
  const [result, setResult] = useState<{ key?: string; data?: T }>({ key })
  const [isLoading, setIsLoading] = useState(!skip)
  // skip が外れた時点で取得が始まるので、同じ key のままでも取得中にする(レンダー中に調整)
  const [prevSkip, setPrevSkip] = useState(skip)
  if (skip !== prevSkip) {
    setPrevSkip(skip)
    if (!skip) {
      setIsLoading(true)
    }
  }
  // reload 連打時に古いレスポンスが後着で state を上書きしないよう世代トークンで管理
  const genRef = useRef(0)
  // isLoading を立てたまま未解決かどうか。倒す責務を「最新世代の完了」へ集約するために持つ
  const isPendingLoadingRef = useRef(!skip)
  // action はインライン関数で渡されることが多いため、常に最新のものを ref 経由で呼ぶ
  const actionRef = useRef(action)
  const keyRef = useRef(key)

  useEffect(() => {
    actionRef.current = action
    keyRef.current = key
  })

  const fetchData = useCallback((silent: boolean, fetchKey: string | undefined) => {
    const gen = ++genRef.current
    if (!silent) {
      isPendingLoadingRef.current = true
    }
    return parseAction(actionRef.current(), { handled: 'all' })
      .then((res) => {
        if (gen === genRef.current) {
          setResult({ key: fetchKey, data: res })
        }
      })
      .catch((e) => {
        console.error(e)
        // 同じ対象の再取得の失敗では前の値を残す。対象が変わっていれば未取得として扱う
        if (gen === genRef.current) {
          setResult((prev) => (prev.key === fetchKey ? prev : { key: fetchKey }))
        }
      })
      .finally(() => {
        if (gen !== genRef.current) {
          // 後着した古い世代。倒すのは最新世代の役目なので触らない
          return
        }
        // silent(refresh)自身は isLoading を立てないが、ローディング中に refresh が
        // 割り込むと元の世代が古くなって倒せなくなるため、最新世代のここで倒す
        // (これをしないと isLoading が true のまま固定される)
        if (isPendingLoadingRef.current) {
          isPendingLoadingRef.current = false
          setIsLoading(false)
        }
      })
  }, [])

  const reload = useCallback(() => {
    setIsLoading(true)
    return fetchData(false, keyRef.current)
  }, [fetchData])

  const refresh = useCallback(() => fetchData(true, keyRef.current), [fetchData])

  useEffect(() => {
    if (!skip) {
      fetchData(false, key)
    }
  }, [fetchData, skip, key])

  // key が変わってから取り直すまでの間。isLoading の state は次の取得が倒すので、ここは導出で持つ
  const isStale = result.key !== key
  return {
    data: isStale ? undefined : result.data,
    reload,
    refresh,
    isLoading: isLoading || (!skip && isStale),
  }
}
