import { ZxcvbnFactory } from '@zxcvbn-ts/core'

/**
 * 辞書データは数MBあるため動的 import で別チャンクに分離し、
 * ranked dictionary の構築コストを避けるためインスタンスは使い回す
 */
let factoryPromise: Promise<ZxcvbnFactory> | undefined

const createFactory = async () => {
  const [common, en] = await Promise.all([import('@zxcvbn-ts/language-common'), import('@zxcvbn-ts/language-en')])

  return new ZxcvbnFactory({
    // dictionary は既定値とマージされず置換されるので、利用する辞書をすべて渡す
    dictionary: { ...common.dictionary, ...en.dictionary },
    graphs: common.adjacencyGraphs,
    // useLevenshteinDistance は 1 回の判定に 150ms 以上かかるため入力中の判定では使わない
  })
}

const getFactory = () => {
  if (!factoryPromise) {
    // 失敗した Promise を持ち続けると以降ずっと同じ失敗を返すので、捨てて次回の呼び出しで読み直す
    factoryPromise = createFactory().catch((error: unknown) => {
      factoryPromise = undefined
      throw error
    })
  }
  return factoryPromise
}

/** 辞書チャンクの先読み */
export const preloadPasswordScore = () => {
  // 失敗しても入力時に読み直すので、ここでは unhandled rejection にしないためだけに捨てる
  void getFactory().catch(() => {})
}

/** パスワード強度(0-4)。辞書が読めなかったときは判定できないので 0 を返す */
export const getPasswordScore = async (password: string) => {
  if (!password) {
    return 0
  }
  try {
    const factory = await getFactory()
    return factory.check(password).score
  } catch (error) {
    console.error(error)
    return 0
  }
}
