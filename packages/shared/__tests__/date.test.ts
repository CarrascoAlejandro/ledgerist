import { parseDateToken, toISODateString, nearestWeekday } from '../src/utils/date.js';

// Fixed reference: 2026-02-18T12:00:00.000Z — Wednesday (day 3)
const REF = new Date('2026-02-18T12:00:00.000Z');
// week start: Monday (1), weekend start: Saturday (6)
const WEEK_START = 1;
const WEEKEND_START = 6;

describe('parseDateToken', () => {
  describe('absolute tokens', () => {
    it('parses "today"', () => {
      expect(parseDateToken('today', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-18');
    });

    it('parses "now"', () => {
      expect(parseDateToken('now', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-18');
    });

    it('parses "tmr"', () => {
      expect(parseDateToken('tmr', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-19');
    });

    it('parses "tomorrow"', () => {
      expect(parseDateToken('tomorrow', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-19');
    });

    it('parses "yst"', () => {
      expect(parseDateToken('yst', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-17');
    });

    it('parses "yesterday"', () => {
      expect(parseDateToken('yesterday', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-17');
    });
  });

  describe('ISO passthrough', () => {
    it('returns ISO date unchanged', () => {
      expect(parseDateToken('2026-01-15', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-15');
    });
  });

  describe('week tokens (week start = Monday)', () => {
    it('parses "next week" → Monday 2026-02-23', () => {
      // From Wednesday Feb 18, next Monday is Feb 23
      expect(parseDateToken('next week', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-23');
    });

    it('parses "last week" → Monday 2026-02-16', () => {
      // From Wednesday Feb 18, last Monday is Feb 16
      expect(parseDateToken('last week', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-16');
    });
  });

  describe('weekend tokens (weekend start = Saturday)', () => {
    it('parses "next weekend" → Saturday 2026-02-21', () => {
      // From Wednesday Feb 18, next Saturday is Feb 21
      expect(parseDateToken('next weekend', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-21');
    });

    it('parses "last weekend" → Saturday 2026-02-14', () => {
      // From Wednesday Feb 18, last Saturday is Feb 14
      expect(parseDateToken('last weekend', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-14');
    });
  });

  describe('month tokens', () => {
    it('parses "next month" → 2026-03-01', () => {
      expect(parseDateToken('next month', WEEK_START, WEEKEND_START, REF)).toBe('2026-03-01');
    });

    it('parses "last month" → 2026-01-01', () => {
      expect(parseDateToken('last month', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-01');
    });
  });

  describe('named day tokens', () => {
    it('parses "next monday"', () => {
      expect(parseDateToken('next monday', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-23');
    });

    it('parses "last friday"', () => {
      // From Wednesday Feb 18, last Friday is Feb 13
      expect(parseDateToken('last friday', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-13');
    });

    it('parses "next saturday"', () => {
      expect(parseDateToken('next saturday', WEEK_START, WEEKEND_START, REF)).toBe('2026-02-21');
    });
  });

  describe('month+day tokens', () => {
    it('parses "Jan25" → 2026-01-25', () => {
      expect(parseDateToken('Jan25', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-25');
    });

    it('parses "25Jan" → 2026-01-25', () => {
      expect(parseDateToken('25Jan', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-25');
    });

    it('parses "January 25" → 2026-01-25', () => {
      expect(parseDateToken('January 25', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-25');
    });
  });

  describe('month+year tokens', () => {
    it('parses "January 2026" → 2026-01-01', () => {
      expect(parseDateToken('January 2026', WEEK_START, WEEKEND_START, REF)).toBe('2026-01-01');
    });

    it('parses "Jan 2025" → 2025-01-01', () => {
      expect(parseDateToken('Jan 2025', WEEK_START, WEEKEND_START, REF)).toBe('2025-01-01');
    });
  });

  describe('invalid tokens', () => {
    it('returns null for unrecognized tokens', () => {
      expect(parseDateToken('notadate', WEEK_START, WEEKEND_START, REF)).toBeNull();
      expect(parseDateToken('', WEEK_START, WEEKEND_START, REF)).toBeNull();
      expect(parseDateToken('2026-99-99', WEEK_START, WEEKEND_START, REF)).toBeNull();
    });
  });
});

describe('toISODateString', () => {
  it('formats UTC date correctly', () => {
    expect(toISODateString(new Date('2026-02-18T00:00:00.000Z'))).toBe('2026-02-18');
    expect(toISODateString(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12-31');
  });
});

describe('nearestWeekday', () => {
  it('finds next Monday from Wednesday', () => {
    // Wednesday Feb 18 → next Monday Feb 23
    const result = nearestWeekday(REF, 1, 'next');
    expect(toISODateString(result)).toBe('2026-02-23');
  });

  it('finds last Monday from Wednesday', () => {
    // Wednesday Feb 18 → last Monday Feb 16
    const result = nearestWeekday(REF, 1, 'last');
    expect(toISODateString(result)).toBe('2026-02-16');
  });

  it('never returns the same day', () => {
    // If ref is a Monday and we ask for next Monday, we get the following Monday
    const monday = new Date('2026-02-16T12:00:00.000Z'); // Monday
    const result = nearestWeekday(monday, 1, 'next');
    expect(toISODateString(result)).toBe('2026-02-23');
  });
});
