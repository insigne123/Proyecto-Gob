export const OPERATING_TIMEZONE = "America/Santiago"

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsInTimeZone(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

function timeZoneOffsetMinutes(date: Date, timeZone: string) {
  const p = partsInTimeZone(date, timeZone)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return (asUTC - date.getTime()) / 60000
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string
) {
  // Initial guess assumes the wall clock time is UTC; then correct by timezone offset.
  const guess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second ?? 0))
  const offset = timeZoneOffsetMinutes(guess, timeZone)
  const corrected = new Date(guess.getTime() - offset * 60_000)
  // One more pass handles most DST boundaries.
  const offset2 = timeZoneOffsetMinutes(corrected, timeZone)
  if (offset2 !== offset) {
    return new Date(guess.getTime() - offset2 * 60_000)
  }
  return corrected
}

export function nextDailyAt(params: {
  timeZone?: string
  hhmm: string
  now?: Date
}) {
  const timeZone = params.timeZone ?? OPERATING_TIMEZONE
  const now = params.now ?? new Date()
  const [hhRaw, mmRaw] = params.hhmm.split(":")
  const hh = Math.max(0, Math.min(23, Number(hhRaw)))
  const mm = Math.max(0, Math.min(59, Number(mmRaw)))

  const pNow = partsInTimeZone(now, timeZone)
  let candidate = zonedDateTimeToUtc(
    {
      year: pNow.year,
      month: pNow.month,
      day: pNow.day,
      hour: hh,
      minute: mm,
      second: 0,
    },
    timeZone
  )

  if (candidate.getTime() <= now.getTime()) {
    // next day
    const tomorrowUTC = new Date(Date.UTC(pNow.year, pNow.month - 1, pNow.day + 1, 12, 0, 0))
    const pTomorrow = partsInTimeZone(tomorrowUTC, timeZone)
    candidate = zonedDateTimeToUtc(
      {
        year: pTomorrow.year,
        month: pTomorrow.month,
        day: pTomorrow.day,
        hour: hh,
        minute: mm,
        second: 0,
      },
      timeZone
    )
  }

  return candidate
}
