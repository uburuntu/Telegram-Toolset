function padDatePart(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatDateInputValue(date: Date): string {
  return [date.getFullYear(), padDatePart(date.getMonth() + 1), padDatePart(date.getDate())].join(
    '-',
  )
}

export function parseDateInputBoundary(value: string, boundary: 'start' | 'end'): Date | undefined {
  if (!value) {
    return undefined
  }

  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) {
    return undefined
  }

  if (boundary === 'start') {
    return new Date(year, month - 1, day, 0, 0, 0, 0)
  }

  return new Date(year, month - 1, day, 23, 59, 59, 999)
}
