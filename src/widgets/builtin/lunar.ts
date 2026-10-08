// Chinese lunar dates via the browser's built-in Chinese calendar; no data tables to ship.
const lunarFormatter = (() => {
  try {
    return new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
  }
  catch {
    return null
  }
})()

const DAY_NAMES = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']
const SOLAR_FESTIVALS: Record<string, string> = { '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '5-1': '劳动节', '6-1': '儿童节', '9-10': '教师节', '10-1': '国庆节', '12-25': '圣诞节' }
const LUNAR_FESTIVALS: Record<string, string> = { '正月-1': '春节', '正月-15': '元宵节', '五月-5': '端午节', '七月-7': '七夕', '七月-15': '中元节', '八月-15': '中秋节', '九月-9': '重阳节', '十二月-8': '腊八' }

export interface LunarDate { month: string; day: string; festival?: string }

export function lunarDate(date: Date): LunarDate | null {
  if (!lunarFormatter)
    return null
  const parts = lunarFormatter.formatToParts(date)
  const month = parts.find(part => part.type === 'month')?.value
  const dayNumber = Number(parts.find(part => part.type === 'day')?.value)
  if (!month || !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 30)
    return null
  const festival = SOLAR_FESTIVALS[`${date.getMonth() + 1}-${date.getDate()}`] ?? LUNAR_FESTIVALS[`${month}-${dayNumber}`]
  return { month: month === '十二月' ? '腊月' : month, day: DAY_NAMES[dayNumber - 1], festival }
}

export function isChineseLocale(locale: string) {
  return locale.toLowerCase().startsWith('zh')
}
