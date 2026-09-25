export const formatByte = (bytesize: number) => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const decimal = 100
  const kiro = 1024

  let size = bytesize
  let unit = units[0]
  for (let i = units.length - 1; i > 0; i--) {
    if (bytesize / Math.pow(kiro, i) > 1) {
      size = Math.round((bytesize / Math.pow(kiro, i)) * decimal) / decimal
      unit = units[i]
      break
    }
  }
  return `${size}${unit}`
}

/** 割合(%、小数第2位で切り捨て)。進捗バーに渡すので 0〜100 に収め、分母が 0 以下なら 0 */
export const calcPercent = (s: number, m: number) =>
  m > 0 ? Math.min(100, Math.max(0, Math.trunc((s / m) * 10000) / 100)) : 0

export const formatTime = (sec: number) => {
  let nextSec = Math.trunc(sec)
  let unitMin = 0
  let unitHour = 0
  let unitDay = 0

  const unitSec = nextSec % 60
  nextSec = Math.trunc(nextSec / 60)
  if (nextSec) {
    unitMin = nextSec % 60
    nextSec = Math.trunc(nextSec / 60)
    if (nextSec) {
      unitHour = nextSec % 24
      unitDay = Math.trunc(nextSec / 24)
    }
  }
  return `${unitDay} days : ${unitHour.toString().padStart(2, '0')} : ${unitMin.toString().padStart(2, '0')} : ${unitSec
    .toString()
    .padStart(2, '0')}`
}
