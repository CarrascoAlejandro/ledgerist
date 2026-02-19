export function toISODateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODateString(new Date());
}

export function tomorrowISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return toISODateString(d);
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return toISODateString(d);
}

/**
 * Find the nearest occurrence of `targetDay` (0=Sun..6=Sat) from `fromDate`,
 * going either 'next' (forward) or 'last' (backward).
 * Never returns fromDate itself.
 */
export function nearestWeekday(
  fromDate: Date,
  targetDay: number,
  direction: 'next' | 'last',
): Date {
  const result = new Date(fromDate);
  const currentDay = result.getUTCDay();
  let delta: number;

  if (direction === 'next') {
    delta = (targetDay - currentDay + 7) % 7;
    if (delta === 0) delta = 7;
  } else {
    delta = (currentDay - targetDay + 7) % 7;
    if (delta === 0) delta = 7;
    delta = -delta;
  }

  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTH_NAMES: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Parse a date token string into an ISO date string (YYYY-MM-DD).
 *
 * @param token - The date token to parse (e.g., "today", "next week", "Jan25")
 * @param weekStartDay - Day of week the week starts on (0=Sun..6=Sat)
 * @param weekendStartDay - Day of week the weekend starts on (0=Sun..6=Sat)
 * @param referenceDate - The reference date to use for relative tokens (defaults to now)
 * @returns ISO date string or null if the token cannot be parsed
 */
export function parseDateToken(
  token: string,
  weekStartDay: number = 1,
  weekendStartDay: number = 6,
  referenceDate?: Date,
): string | null {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const normalized = token.trim().toLowerCase();

  // ISO passthrough — validate calendar correctness before accepting
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [y, m, d] = normalized.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    ) {
      return normalized;
    }
    return null;
  }

  // today / now
  if (normalized === 'today' || normalized === 'now') {
    return toISODateString(ref);
  }

  // tomorrow
  if (normalized === 'tmr' || normalized === 'tomorrow') {
    const d = new Date(ref);
    d.setUTCDate(d.getUTCDate() + 1);
    return toISODateString(d);
  }

  // yesterday
  if (normalized === 'yst' || normalized === 'yesterday') {
    const d = new Date(ref);
    d.setUTCDate(d.getUTCDate() - 1);
    return toISODateString(d);
  }

  // "next week" → first day of next week
  if (normalized === 'next week') {
    const d = nearestWeekday(ref, weekStartDay, 'next');
    return toISODateString(d);
  }

  // "last week" → first day of previous week
  if (normalized === 'last week') {
    const d = nearestWeekday(ref, weekStartDay, 'last');
    return toISODateString(d);
  }

  // "next weekend"
  if (normalized === 'next weekend') {
    const d = nearestWeekday(ref, weekendStartDay, 'next');
    return toISODateString(d);
  }

  // "last weekend"
  if (normalized === 'last weekend') {
    const d = nearestWeekday(ref, weekendStartDay, 'last');
    return toISODateString(d);
  }

  // "next month" → first day of next month
  if (normalized === 'next month') {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
    return toISODateString(d);
  }

  // "last month" → first day of previous month
  if (normalized === 'last month') {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1));
    return toISODateString(d);
  }

  // "next <dayname>" or "last <dayname>"
  const nextLastDay = normalized.match(/^(next|last)\s+(\w+)$/);
  if (nextLastDay) {
    const dir = nextLastDay[1] as 'next' | 'last';
    const dayName = nextLastDay[2];
    const dayNum = DAY_NAMES[dayName];
    if (dayNum !== undefined) {
      return toISODateString(nearestWeekday(ref, dayNum, dir));
    }
  }

  // "January 2026" → first day of that month
  const monthYear = normalized.match(/^([a-z]+)\s+(\d{4})$/);
  if (monthYear) {
    const monthNum = MONTH_NAMES[monthYear[1]];
    if (monthNum !== undefined) {
      const year = parseInt(monthYear[2], 10);
      return toISODateString(new Date(Date.UTC(year, monthNum, 1)));
    }
  }

  // "January 25" / "Jan 25" → that month/day in reference year
  const monthDay = normalized.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (monthDay) {
    const monthNum = MONTH_NAMES[monthDay[1]];
    if (monthNum !== undefined) {
      const day = parseInt(monthDay[2], 10);
      return toISODateString(new Date(Date.UTC(ref.getUTCFullYear(), monthNum, day)));
    }
  }

  // "Jan25" or "25Jan" — no space variants
  const noSpaceMonthDay = normalized.match(/^([a-z]+)(\d{1,2})$/);
  if (noSpaceMonthDay) {
    const monthNum = MONTH_NAMES[noSpaceMonthDay[1]];
    if (monthNum !== undefined) {
      const day = parseInt(noSpaceMonthDay[2], 10);
      return toISODateString(new Date(Date.UTC(ref.getUTCFullYear(), monthNum, day)));
    }
  }

  const noSpaceDayMonth = normalized.match(/^(\d{1,2})([a-z]+)$/);
  if (noSpaceDayMonth) {
    const monthNum = MONTH_NAMES[noSpaceDayMonth[2]];
    if (monthNum !== undefined) {
      const day = parseInt(noSpaceDayMonth[1], 10);
      return toISODateString(new Date(Date.UTC(ref.getUTCFullYear(), monthNum, day)));
    }
  }

  return null;
}
