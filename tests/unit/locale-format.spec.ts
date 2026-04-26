import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import {
  formatDateWithLocale,
  formatNumberWithLocale,
  formatRelativeTimeFromNow,
  getActiveLocale,
} from '@/utils/locale-format'

describe('locale formatting utilities', () => {
  afterEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('returns the active i18n locale', () => {
    i18n.global.locale.value = 'ru'

    expect(getActiveLocale()).toBe('ru')
  })

  it('formats dates and numbers with the provided locale', () => {
    const date = new Date('2024-01-10T15:30:00Z')
    const dateOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }
    const numberOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }

    expect(formatDateWithLocale(date, dateOptions, 'en-GB')).toBe(
      new Intl.DateTimeFormat('en-GB', dateOptions).format(date),
    )
    expect(formatNumberWithLocale(12345.678, numberOptions, 'de-DE')).toBe(
      new Intl.NumberFormat('de-DE', numberOptions).format(12345.678),
    )
  })

  it('formats relative time across day, hour, minute, and current-minute branches', () => {
    const now = new Date('2024-01-10T12:00:00Z')
    const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

    expect(formatRelativeTimeFromNow(new Date('2024-01-12T12:00:00Z'), 'en', now)).toBe(
      formatter.format(2, 'day'),
    )
    expect(formatRelativeTimeFromNow(new Date('2024-01-10T14:00:00Z'), 'en', now)).toBe(
      formatter.format(2, 'hour'),
    )
    expect(formatRelativeTimeFromNow(new Date('2024-01-10T12:20:00Z'), 'en', now)).toBe(
      formatter.format(20, 'minute'),
    )
    expect(formatRelativeTimeFromNow(new Date('2024-01-10T12:00:20Z'), 'en', now)).toBe(
      formatter.format(0, 'minute'),
    )
  })
})
