import { parseSourceDateTime, toNaiveIso } from './parse-date';

// Helper: assert calendar parts rather than an instant, since the parser
// deliberately produces wall-clock dates.
function parts(d: Date | null) {
  if (!d) return null;
  return [
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ];
}

describe('parseSourceDateTime', () => {
  describe('UK dd/MM/yyyy (the house format)', () => {
    it('reads day-first, not month-first', () => {
      // The whole reason this helper exists: new Date('01/02/2026') is Jan 2nd.
      expect(parts(parseSourceDateTime('01/02/2026 09:15:00'))).toEqual([
        2026, 2, 1, 9, 15, 0,
      ]);
    });

    it('parses the format used by the existing data extracts', () => {
      expect(parts(parseSourceDateTime('19/02/2025 15:38:00'))).toEqual([
        2025, 2, 19, 15, 38, 0,
      ]);
    });

    it('honours dateOrder=mdy when asked', () => {
      expect(parts(parseSourceDateTime('01/02/2026 09:15:00', 'mdy'))).toEqual([
        2026, 1, 2, 9, 15, 0,
      ]);
    });

    it('trusts the data over the configured order when the month slot exceeds 12', () => {
      // 25 cannot be a month, so this is dd/MM even though mdy was requested.
      expect(parts(parseSourceDateTime('25/12/2026', 'mdy'))).toEqual([
        2026, 12, 25, 0, 0, 0,
      ]);
    });

    it('handles a missing time', () => {
      expect(parts(parseSourceDateTime('19/02/2025'))).toEqual([
        2025, 2, 19, 0, 0, 0,
      ]);
    });

    it('handles two-digit years', () => {
      expect(parts(parseSourceDateTime('19/02/25'))).toEqual([
        2025, 2, 19, 0, 0, 0,
      ]);
      expect(parts(parseSourceDateTime('19/02/85'))).toEqual([
        1985, 2, 19, 0, 0, 0,
      ]);
    });

    it('handles 12-hour times with a meridiem', () => {
      expect(parts(parseSourceDateTime('19/02/2025 3:38:00 PM'))).toEqual([
        2025, 2, 19, 15, 38, 0,
      ]);
      expect(parts(parseSourceDateTime('19/02/2025 12:05 AM'))).toEqual([
        2025, 2, 19, 0, 5, 0,
      ]);
      expect(parts(parseSourceDateTime('19/02/2025 12:05 PM'))).toEqual([
        2025, 2, 19, 12, 5, 0,
      ]);
    });

    it('rejects impossible calendar dates instead of rolling them forward', () => {
      // new Date(2025, 1, 31) would silently become March 3rd.
      expect(parseSourceDateTime('31/02/2025')).toBeNull();
    });
  });

  describe('ISO', () => {
    it('parses a date-only value', () => {
      expect(parts(parseSourceDateTime('2026-06-01'))).toEqual([
        2026, 6, 1, 0, 0, 0,
      ]);
    });

    it('parses a space-separated datetime', () => {
      expect(parts(parseSourceDateTime('2026-06-01 14:03:07'))).toEqual([
        2026, 6, 1, 14, 3, 7,
      ]);
    });

    it('parses a T-separated datetime with fractional seconds', () => {
      expect(parts(parseSourceDateTime('2026-06-01T14:03:07.123'))).toEqual([
        2026, 6, 1, 14, 3, 7,
      ]);
    });

    it('treats a naive ISO value as wall-clock, not UTC', () => {
      // Guards against a timezone shift shunting an early-morning conversation
      // into the previous day.
      expect(parts(parseSourceDateTime('2026-06-01T00:30:00'))).toEqual([
        2026, 6, 1, 0, 30, 0,
      ]);
    });

    it('respects an explicit offset as a real instant', () => {
      const d = parseSourceDateTime('2026-06-01T14:03:07Z');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-06-01T14:03:07.000Z');
    });

    it('parses yyyy/MM/dd', () => {
      expect(parts(parseSourceDateTime('2026/06/01 14:03'))).toEqual([
        2026, 6, 1, 14, 3, 0,
      ]);
    });
  });

  describe('Excel serials', () => {
    it('parses a whole-day serial', () => {
      // 45809 = 2025-06-01 in Excel's 1900 date system.
      expect(parts(parseSourceDateTime('45809'))).toEqual([2025, 6, 1, 0, 0, 0]);
    });

    it('parses a fractional serial as a time of day', () => {
      expect(parts(parseSourceDateTime('45809.5'))).toEqual([
        2025, 6, 1, 12, 0, 0,
      ]);
    });

    it('rounds a fraction that lands just short of a whole minute', () => {
      // 45707.385416 is 09:14:59.942. Rounding the seconds component alone would
      // produce 60 and be rejected as an invalid time.
      expect(parts(parseSourceDateTime('45707.385416'))).toEqual([
        2025, 2, 19, 9, 15, 0,
      ]);
    });

    it('rounds a fraction that lands just short of midnight without losing the day', () => {
      // 23:59:59.9 must not round up into the next day's 00:00:00.
      const d = parseSourceDateTime('45707.9999998');
      expect(d).not.toBeNull();
      expect(d!.getDate()).toBe(20);
      expect([d!.getHours(), d!.getMinutes(), d!.getSeconds()]).toEqual([0, 0, 0]);
    });

    it('ignores small integers that cannot be dates', () => {
      // Durations and message counts must never be read as dates.
      expect(parseSourceDateTime('0')).toBeNull();
      expect(parseSourceDateTime('42')).toBeNull();
      expect(parseSourceDateTime('1200')).toBeNull();
    });
  });

  describe('rejections', () => {
    it.each([null, undefined, '', '   ', 'not a date', 'N/A', '-'])(
      'returns null for %p',
      (input) => {
        expect(parseSourceDateTime(input as unknown)).toBeNull();
      },
    );

    it('passes a Date through unchanged', () => {
      const d = new Date(2026, 5, 1, 14, 3, 7);
      expect(parseSourceDateTime(d)).toBe(d);
    });

    it('returns null for an invalid Date', () => {
      expect(parseSourceDateTime(new Date('nope'))).toBeNull();
    });
  });
});

describe('toNaiveIso', () => {
  it('emits no Z and no offset, so the drawer renders wall-clock time', () => {
    expect(toNaiveIso(new Date(2026, 5, 1, 14, 3, 7))).toBe('2026-06-01T14:03:07');
  });

  it('zero-pads every component', () => {
    expect(toNaiveIso(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05');
  });
});
