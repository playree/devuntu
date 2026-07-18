'use client'

import { notify } from '@/components/notify'
import { useEffect, useState } from 'react'
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
 * サーバーアクションをマウント時に1回実行し、結果を返す。
 * エラー時は parseAction が throw / notify するため data は undefined のまま。
 */
export const useActionData = <T>(
  action: () => Promise<{
    data?: T
    serverError?: { name?: string; errorType: string }
    validationErrors?: unknown
  }>,
) => {
  const [data, setData] = useState<T>()

  useEffect(() => {
    parseAction(action())
      .then((res) => setData(res))
      .catch((e) => {
        console.error(e)
      })
    // マウント時1回のみ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return data
}
