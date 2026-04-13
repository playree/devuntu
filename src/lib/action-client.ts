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
): Promise<T['data']> => {
  const result = await res
  if (result.serverError || result.validationErrors) {
    throw new Error()
  }
  return result.data
}
