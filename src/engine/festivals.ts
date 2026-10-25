/**
 * Festivals the agents know about. Dates come from rules or from the runtime's own calendars wherever possible,
 * so nothing is hand-typed except Diwali, whose dates need an astronomical table (marked approximate).
 */
export interface Festival {
  id: string;
  name: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Dates that depend on moon sighting or a table can be a day off. */
  approx: boolean;
}

/** On by default for every circle. Everything else is opt-in: Rally does not presume what a group celebrates. */
export const DEFAULT_FESTIVALS = ['halloween', 'thanksgiving', 'new-years-eve', 'st-patricks-day', 'galentines-day'];
export const OPT_IN_FESTIVALS = ['diwali', 'lunar-new-year', 'eid-al-fitr', 'eid-al-adha'];
export const ALL_FESTIVALS = [...DEFAULT_FESTIVALS, ...OPT_IN_FESTIVALS];

const NAMES: Record<string, string> = {
  halloween: 'Halloween',
  thanksgiving: 'Thanksgiving',
  'new-years-eve': "New Year's Eve",
  'st-patricks-day': "St. Patrick's Day",
  'galentines-day': "Galentine's Day",
  diwali: 'Diwali',
  'lunar-new-year': 'Lunar New Year',
  'eid-al-fitr': 'Eid al-Fitr',
  'eid-al-adha': 'Eid al-Adha',
};

/** Diwali (the main night) by year. Approximate: the festival follows the Hindu lunisolar calendar. */
const DIWALI: Record<number, string> = { 2026: '11-08', 2027: '10-29', 2028: '10-17', 2029: '11-05', 2030: '10-26' };

/**
 * Lunar New Year (the day of the new moon that starts the year, in China), published dates. The runtime's own Chinese
 * calendar is a day late in 2027, when the new moon falls eight minutes before midnight in Beijing, so it is only a
 * fallback for years outside this table.
 */
const LUNAR_NEW_YEAR: Record<number, string> = {
  2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03',
  2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08',
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The day of the month of the nth given weekday (0 = Sunday), for month0 = 0 to 11. */
function nthWeekday(year: number, month0: number, weekday: number, n: number): number {
  let seen = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(year, month0, d));
    if (dt.getUTCMonth() !== month0) break;
    if (dt.getUTCDay() === weekday && ++seen === n) return d;
  }
  throw new Error('no such weekday');
}

/** Scan Gregorian days of `year` for the first whose date in another calendar matches. */
function findInCalendar(calendar: string, zone: string, utcHourForNoon: number, year: number, match: (month: string, day: string) => boolean): string | undefined {
  const fmt = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: zone, month: 'numeric', day: 'numeric' });
  for (let t = Date.UTC(year, 0, 1, utcHourForNoon); t < Date.UTC(year + 1, 0, 1, utcHourForNoon); t += 86_400_000) {
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    if (match(parts.month ?? '', parts.day ?? '')) {
      const d = new Date(t);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return undefined;
}

/** Every festival whose date falls in the given year. */
export function festivalsOfYear(year: number): Festival[] {
  const out: Festival[] = [
    { id: 'halloween', date: iso(year, 10, 31), approx: false },
    { id: 'thanksgiving', date: iso(year, 11, nthWeekday(year, 10, 4, 4)), approx: false },
    { id: 'new-years-eve', date: iso(year, 12, 31), approx: false },
    { id: 'st-patricks-day', date: iso(year, 3, 17), approx: false },
    { id: 'galentines-day', date: iso(year, 2, 13), approx: false },
  ].map((f) => ({ ...f, name: NAMES[f.id]! }));
  const diwali = DIWALI[year];
  if (diwali) out.push({ id: 'diwali', name: NAMES.diwali!, date: `${year}-${diwali}`, approx: true });
  const known = LUNAR_NEW_YEAR[year];
  if (known) out.push({ id: 'lunar-new-year', name: NAMES['lunar-new-year']!, date: `${year}-${known}`, approx: false });
  else {
    // China's day starts at 16:00 UTC the evening before, so look at noon in Shanghai (04:00 UTC).
    const lunar = findInCalendar('chinese', 'Asia/Shanghai', 4, year, (m, d) => m === '1' && d === '1');
    if (lunar) out.push({ id: 'lunar-new-year', name: NAMES['lunar-new-year']!, date: lunar, approx: true });
  }
  const fitr = findInCalendar('islamic-umalqura', 'UTC', 12, year, (m, d) => m === '10' && d === '1');
  if (fitr) out.push({ id: 'eid-al-fitr', name: NAMES['eid-al-fitr']!, date: fitr, approx: true });
  const adha = findInCalendar('islamic-umalqura', 'UTC', 12, year, (m, d) => m === '12' && d === '10');
  if (adha) out.push({ id: 'eid-al-adha', name: NAMES['eid-al-adha']!, date: adha, approx: true });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
};

export function festivalName(id: string): string | undefined {
  return NAMES[id];
}

/**
 * Enabled festivals that fall within `withinDays` days of `today` (a local YYYY-MM-DD), soonest first.
 * Looks into next year too, so late December finds January and February festivals.
 */
export function upcomingFestivals(today: string, withinDays: number, enabled: string[]): (Festival & { daysAway: number })[] {
  const year = Number(today.slice(0, 4));
  const from = dayNumber(today);
  return [...festivalsOfYear(year), ...festivalsOfYear(year + 1)]
    .filter((f) => enabled.includes(f.id))
    .map((f) => ({ ...f, daysAway: dayNumber(f.date) - from }))
    .filter((f) => f.daysAway >= 0 && f.daysAway <= withinDays)
    .sort((a, b) => a.daysAway - b.daysAway);
}
