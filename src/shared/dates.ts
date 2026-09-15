/**
 * MERQO shared date/time utilities.
 *
 * Dates are stored as INTEGER unix epoch milliseconds (UTC).
 * Display is timezone-aware using the device local timezone (the shop's
 * timezone), which is the correct behavior for a local desktop app.
 */

export type EPOCH = number;

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** Convert Western digits in a string to Bangla digits. */
export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

const WEEKDAYS_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

export interface DateRange {
  /** inclusive start (epoch ms, local midnight) */
  from: EPOCH;
  /** inclusive end (epoch ms, local 23:59:59.999) */
  to: EPOCH;
}

export function startOfDayLocal(ms: EPOCH): EPOCH {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayLocal(ms: EPOCH): EPOCH {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function addDaysLocal(ms: EPOCH, days: number): EPOCH {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addMonthsLocal(ms: EPOCH, months: number): EPOCH {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** "YYYY-MM-DD" in local time (for inputs/exports). */
export function toYMD(ms: EPOCH): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromYMD(ymd: string): EPOCH {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

export interface RangePresetKey {
  key: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'last6m' | 'thisYear' | 'custom';
  label: string;
}

export const RANGE_PRESETS: RangePresetKey[] = [
  { key: 'today', label: 'আজ' },
  { key: 'last7', label: 'গত ৭ দিন' },
  { key: 'thisMonth', label: 'এই মাস' },
  { key: 'last3m', label: 'গত ৩ মাস' },
  { key: 'last6m', label: 'গত ৬ মাস' },
  { key: 'thisYear', label: 'এই বছর' },
  { key: 'custom', label: 'কাস্টম' }
];

/** Resolve a range preset to an inclusive [from, to] pair (local time). */
export function resolveRange(
  preset: RangePresetKey['key'],
  now: EPOCH = Date.now(),
  custom?: { from: EPOCH; to: EPOCH }
): DateRange {
  const today = startOfDayLocal(now);
  switch (preset) {
    case 'today':
      return { from: today, to: endOfDayLocal(now) };
    case 'last7':
      return { from: addDaysLocal(today, -6), to: endOfDayLocal(now) };
    case 'thisMonth': {
      const d = new Date(today);
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: endOfDayLocal(now) };
    }
    case 'last3m': {
      const d = new Date(today);
      return { from: new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime(), to: endOfDayLocal(now) };
    }
    case 'last6m': {
      const d = new Date(today);
      return { from: new Date(d.getFullYear(), d.getMonth() - 5, 1).getTime(), to: endOfDayLocal(now) };
    }
    case 'thisYear': {
      const d = new Date(today);
      return { from: new Date(d.getFullYear(), 0, 1).getTime(), to: endOfDayLocal(now) };
    }
    case 'custom': {
      if (!custom) return { from: today, to: endOfDayLocal(now) };
      return { from: startOfDayLocal(custom.from), to: endOfDayLocal(custom.to) };
    }
  }
}

/** "১৫ সেপ্টেম্বর ২০২৬" */
export function formatDateBn(ms: EPOCH): string {
  const d = new Date(ms);
  return `${toBanglaDigits(d.getDate())} ${MONTHS_BN[d.getMonth()]} ${toBanglaDigits(d.getFullYear())}`;
}

/** "১০:৩০ PM" */
export function formatTimeBn(ms: EPOCH): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = `${d.getMinutes()}`.padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${toBanglaDigits(`${h}:${m}`)} ${ampm}`;
}

/** "১৫ সেপ্টেম্বর ২০২, ১০:৩০ PM" */
export function formatDateTimeBn(ms: EPOCH): string {
  return `${formatDateBn(ms)}, ${formatTimeBn(ms)}`;
}

/** "রবিবার, ১৫ সেপ্টেম্বর ২০৬" */
export function formatFullDateBn(ms: EPOCH): string {
  const d = new Date(ms);
  return `${WEEKDAYS_BN[d.getDay()]}, ${formatDateBn(ms)}`;
}

/** Short "DD MMM" in Bangla for chart axes. */
export function formatShortDateBn(ms: EPOCH): string {
  const d = new Date(ms);
  return `${toBanglaDigits(d.getDate())} ${MONTHS_BN[d.getMonth()].slice(0, 4)}`;
}

/** Weekday name in Bangla. */
export function formatWeekdayBn(ms: EPOCH): string {
  return WEEKDAYS_BN[new Date(ms).getDay()];
}

/** Day bucket key "YYYY-MM-DD" for grouping analytics. */
export function dayKey(ms: EPOCH): string {
  return toYMD(startOfDayLocal(ms));
}
