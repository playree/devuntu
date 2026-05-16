import { toast } from '@heroui/react'
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

export const parseAction = async <T extends { data?: unknown; serverError?: unknown; validationErrors?: unknown }>(
  res: Promise<T>,
  wait: number = 300,
): Promise<T['data']> => {
  const start = performance.now()
  const result = await res
  const execTime = ~~(performance.now() - start)
  console.debug('action exec', execTime)

  if (result.serverError || result.validationErrors) {
    toast.danger('Error', { description: 'An error has occurred' })
    console.error('action error', result.serverError || result.validationErrors)
    throw new Error()
  }

  if (wait - execTime > 0) {
    await intervalOperation(wait - execTime)
  }

  return result.data
}
