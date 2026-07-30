// Date parsing for imported source files.
//
// Deliberately does NOT fall back to `new Date(str)` for slash-separated dates:
// V8 reads 01/02/2026 as January 2nd, so a UK dd/MM/yyyy feed would silently
// land with the day and month swapped for every date where day <= 12 — wrong,
// and invisible until someone audits a monthly total.

export type DateOrder = 'dmy' | 'mdy' | 'iso';

// Excel serial dates count from 1899-12-30 (the epoch that reproduces Excel's
// 1900 leap-year bug for all dates after 1900-03-01).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

// Plausible-serial window: ~1954-10-03 to ~2119-01-06. Narrow enough that a
// small integer like a duration or a message count is never mistaken for a date.
const EXCEL_SERIAL_MIN = 20_000;
const EXCEL_SERIAL_MAX = 80_000;

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,7}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

const SLASH_RE =
  /^(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([AaPp][Mm])?$/;

/**
 * Builds a Date from calendar parts, treating them as wall-clock rather than
 * UTC. `interactions.interactionDateTime` is datetime2 with no offset and every
 * dashboard groups by UK day, so the parts must survive the round trip
 * unshifted — using Date.UTC here would move an 00:30 conversation to the
 * previous day once the driver wrote it back out.
 */
function fromParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute, second, ms);
  // Rejects overflowed calendar dates such as 31/02 that the Date constructor
  // would otherwise roll forward into March.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

function applyMeridiem(hour: number, meridiem?: string): number | null {
  if (!meridiem) return hour;
  const isPm = meridiem.toLowerCase() === 'pm';
  if (hour < 1 || hour > 12) return null;
  if (isPm) return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour;
}

/**
 * Parses a source date cell. Handles, in order:
 *   - ISO 8601, with or without a time, with or without an offset/Z
 *   - yyyy-MM-dd HH:mm[:ss]
 *   - dd/MM/yyyy HH:mm[:ss] (UK house format) or MM/dd/yyyy when order='mdy'
 *   - two-digit years (00-69 -> 2000s, 70-99 -> 1900s)
 *   - Excel serial numbers, which appear whenever someone opens the export in
 *     Excel and re-saves it
 *
 * Returns null for anything it cannot parse unambiguously — callers raise
 * E_NO_DATE rather than guessing.
 */
export function parseSourceDateTime(
  value: unknown,
  order: DateOrder = 'dmy',
): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  // ── ISO / yyyy-MM-dd ──────────────────────────────────────────────────────
  const iso = ISO_RE.exec(raw);
  if (iso) {
    const [, y, mo, d, h, mi, s, frac, offset] = iso;
    // An explicit offset means the instant is unambiguous: let Date do the
    // conversion, then keep it as-is.
    if (offset) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return fromParts(
      Number(y),
      Number(mo),
      Number(d),
      h ? Number(h) : 0,
      mi ? Number(mi) : 0,
      s ? Number(s) : 0,
      frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0,
    );
  }

  // ── slash / dot separated ─────────────────────────────────────────────────
  const slash = SLASH_RE.exec(raw);
  if (slash) {
    const [, a, b, c, h, mi, s, meridiem] = slash;
    const first = Number(a);
    const second = Number(b);
    const third = Number(c);

    let year: number;
    let month: number;
    let day: number;

    if (a!.length === 4) {
      // yyyy/MM/dd
      year = first;
      month = second;
      day = third;
    } else {
      year = third;
      if (order === 'mdy') {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }
      // A value above 12 in the month slot can only be a day — the feed
      // contradicted the configured order, so trust the data.
      if (month > 12 && day <= 12) {
        const swap = month;
        month = day;
        day = swap;
      }
      if (c!.length <= 2) year = third <= 69 ? 2000 + third : 1900 + third;
    }

    const hour = applyMeridiem(h ? Number(h) : 0, meridiem);
    if (hour === null) return null;

    return fromParts(
      year,
      month,
      day,
      hour,
      mi ? Number(mi) : 0,
      s ? Number(s) : 0,
    );
  }

  // ── Excel serial ──────────────────────────────────────────────────────────
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial >= EXCEL_SERIAL_MIN && serial <= EXCEL_SERIAL_MAX) {
      // Excel day fractions are binary approximations, so a time that should be
      // 09:15:00 arrives as 09:14:59.942. Round the whole instant to the nearest
      // second BEFORE decomposing it — rounding the seconds component alone
      // would yield 60 and be rejected as an invalid time.
      const ms = EXCEL_EPOCH_MS + serial * MS_PER_DAY;
      const utc = new Date(Math.round(ms / 1000) * 1000);
      // The serial encodes wall-clock, so rebuild from UTC parts as local.
      return fromParts(
        utc.getUTCFullYear(),
        utc.getUTCMonth() + 1,
        utc.getUTCDate(),
        utc.getUTCHours(),
        utc.getUTCMinutes(),
        utc.getUTCSeconds(),
      );
    }
  }

  return null;
}

/** `true` when the cell holds a value parse-able as a date. */
export function looksLikeDate(value: unknown, order: DateOrder = 'dmy'): boolean {
  return parseSourceDateTime(value, order) !== null;
}

/**
 * Formats a Date as a naive-local ISO string (no Z, no offset).
 *
 * Transcript message timestamps are rendered by InteractionDetailDrawer via
 * `new Date(ts).toLocaleTimeString()`. A Z-suffixed value would be shifted into
 * the viewer's timezone; a naive string renders the wall-clock the agent saw.
 */
export function toNaiveIso(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}
