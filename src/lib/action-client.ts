'use client'

import { notify } from '@/components/notify'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errClient } from './error'
import { intervalOperation } from './sleep'

type MarkDataResolved<T> = T & {
  data: NonNullable<T extends { data?: infer U } ? U : never>
}

export function checkError<T extends { data?: unknown; serverError?: unknown; validationErrors?: unknown }>(
  res: T,
): asserts res is MarkDataResolved<T> {
  if (res.serverError || res.validationErrors) {
    throw new Error()
  }
}

export const parseAction = async <
  T extends { data?: unknown; serverError?: { name?: string; errorType: string }; validationErrors?: unknown },
>(
  res: Promise<T>,
  wait: number = 300,
) => {
  const start = performance.now()
  const result = await res
  const execTime = ~~(performance.now() - start)
  console.debug('action exec', execTime)

  if (result.serverError?.name === 'ClientError') {
    console.debug(result.serverError)
    throw errClient(result.serverError.errorType)
  }

  if (result.serverError || result.validationErrors) {
    notify.error('Error', { description: 'An error has occurred' })
    console.error('action error', result.serverError || result.validationErrors)
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

/**
 * サーバーアクションをマウント時に実行し、結果を返す。
 * reload で再取得でき、isLoading で取得中かどうかを判定できる。
 * エラー時は parseAction が throw / notify するため data は undefined のまま。
 * action は毎レンダー再生成されるインライン関数でもよい(常に最新のものを呼ぶ)。
 * ただし action が参照する値の変化では自動再取得しないため、必要なら reload を呼ぶ。
 */
export const useActionData = <T>(
  action: () => Promise<{
    data?: T
    serverError?: { name?: string; errorType: string }
    validationErrors?: unknown
  }>,
) => {
  const [data, setData] = useState<T>()
  const [isLoading, setIsLoading] = useState(true)
  // reload 連打時に古いレスポンスが後着で state を上書きしないよう世代トークンで管理
  const genRef = useRef(0)
  // action はインライン関数で渡されることが多いため、常に最新のものを ref 経由で呼ぶ
  const actionRef = useRef(action)

  useEffect(() => {
    actionRef.current = action
  })

  const fetchData = useCallback(() => {
    const gen = ++genRef.current
    return parseAction(actionRef.current())
      .then((res) => {
        if (gen === genRef.current) {
          setData(res)
        }
      })
      .catch((e) => {
        console.error(e)
      })
      .finally(() => {
        if (gen === genRef.current) {
          setIsLoading(false)
        }
      })
  }, [])

  const reload = useCallback(() => {
    setIsLoading(true)
    return fetchData()
  }, [fetchData])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, reload, isLoading }
}
