import { i18n } from '@/i18n'

export function getActiveLocale(): string {
  return i18n.global.locale.value
}

export function formatDateWithLocale(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  locale: string = getActiveLocale(),
): string {
  return new Intl.DateTimeFormat(locale, options).format(date)
}

export function formatNumberWithLocale(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: string = getActiveLocale(),
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatRelativeTimeFromNow(
  targetDate: Date,
  locale: string = getActiveLocale(),
  now: Date = new Date(),
): string {
  const diffMs = targetDate.getTime() - now.getTime()
  const diffMinutes = Math.round(diffMs / 60000)
  const diffHours = Math.round(diffMinutes / 60)
  const diffDays = Math.round(diffHours / 24)

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (Math.abs(diffDays) >= 1) {
    return formatter.format(diffDays, 'day')
  }

  if (Math.abs(diffHours) >= 1) {
    return formatter.format(diffHours, 'hour')
  }

  if (Math.abs(diffMinutes) >= 1) {
    return formatter.format(diffMinutes, 'minute')
  }

  return formatter.format(0, 'minute')
}
