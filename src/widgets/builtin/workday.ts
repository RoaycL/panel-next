import { lunarDate } from './lunar'

/** Optional chips the off-work widget can show under the timer. */
export const WORKDAY_EXTRAS = ['payday', 'friday', 'holiday', 'income'] as const
export type WorkdayExtra = typeof WORKDAY_EXTRAS[number]

export const WORKDAY_FONTS = ['system', 'rounded', 'harmony', 'serif', 'mono'] as const
export type WorkdayFont = typeof WORKDAY_FONTS[number]

export const WORKDAY_FONT_STACKS: Record<WorkdayFont, string> = {
  system: 'inherit',
  rounded: '"SF Pro Rounded", "Nunito", "Varela Round", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  harmony: '"HarmonyOS Sans SC", "HarmonyOS Sans", "HarmonyOS_Sans_SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  mono: '"SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace',
}

export const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const WORKDAYS_PATTERN = /^(?!.*(\d).*\1)[1-7]{0,7}$/

export type WorkdayKind = 'before' | 'working' | 'done' | 'rest' | 'invalid'

export interface WorkdaySettings {
  workdays: string
  startTime: string
  endTime: string
  payday: number
  dailyIncome: number
}

export interface WorkdayState {
  kind: WorkdayKind
  /** Seconds until the next boundary: start when before work, end while working. */
  seconds: number
  /** Share of today's working window already done, 0–1. */
  progress: number
  /** What today's work has earned so far. */
  earned: number
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: Date) {
  return date.getDay() === 0 ? 7 : date.getDay()
}

function atTime(date: Date, time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute)
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000)
}

export function workdayState(now: Date, settings: WorkdaySettings): WorkdayState {
  if (!TIME_PATTERN.test(settings.startTime) || !TIME_PATTERN.test(settings.endTime))
    return { kind: 'invalid', seconds: 0, progress: 0, earned: 0 }
  if (!settings.workdays.includes(String(isoWeekday(now))))
    return { kind: 'rest', seconds: 0, progress: 0, earned: 0 }
  const start = atTime(now, settings.startTime)
  const end = atTime(now, settings.endTime)
  // A window that ends before it starts runs past midnight.
  if (end <= start)
    end.setDate(end.getDate() + 1)
  const span = end.getTime() - start.getTime()
  const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), 0), span)
  const progress = span > 0 ? elapsed / span : 0
  const earned = settings.dailyIncome * progress
  if (now < start)
    return { kind: 'before', seconds: Math.ceil((start.getTime() - now.getTime()) / 1000), progress: 0, earned: 0 }
  if (now < end)
    return { kind: 'working', seconds: Math.ceil((end.getTime() - now.getTime()) / 1000), progress, earned }
  return { kind: 'done', seconds: 0, progress: 1, earned }
}

export function formatClock(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

export function daysUntilPayday(now: Date, payday: number) {
  const clamp = (year: number, month: number) => new Date(year, month, Math.min(payday, new Date(year, month + 1, 0).getDate()))
  let next = clamp(now.getFullYear(), now.getMonth())
  if (daysBetween(now, next) < 0)
    next = clamp(now.getFullYear(), now.getMonth() + 1)
  return daysBetween(now, next)
}

export function daysUntilFriday(now: Date) {
  return (5 - isoWeekday(now) + 7) % 7
}

// Qingming falls on 4 or 5 April; this is the standard 21st-century solar-term formula.
function qingmingDay(year: number) {
  const y = year % 100
  return Math.floor(y * 0.2422 + 4.81) - Math.floor((y - 1) / 4)
}

function festivalOn(date: Date) {
  if (date.getMonth() === 3 && date.getDate() === qingmingDay(date.getFullYear()))
    return '清明节'
  const lunar = lunarDate(date)
  if (lunar?.festival)
    return lunar.festival
  const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  if (lunarDate(tomorrow)?.festival === '春节')
    return '除夕'
  return ''
}

/** Next festival from today (inclusive), searched a little over a year ahead. */
export function nextFestival(now: Date): { name: string; days: number } | null {
  const today = startOfDay(now)
  for (let offset = 0; offset <= 400; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
    const name = festivalOn(date)
    if (name)
      return { name, days: offset }
  }
  return null
}
