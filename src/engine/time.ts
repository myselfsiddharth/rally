import type { Interval, Ms } from './types';

export const MINUTE: Ms = 60_000;
export const HOUR: Ms = 60 * MINUTE;
export const DAY: Ms = 24 * HOUR;
export const WEEK: Ms = 7 * DAY;

/** Sort, merge overlapping or touching intervals, and drop empty or inverted ones. */
export function merge(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Intersection of two lists of intervals. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const x = merge(a);
  const y = merge(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const p = x[i]!;
    const q = y[j]!;
    const start = Math.max(p.start, q.start);
    const end = Math.min(p.end, q.end);
    if (end > start) out.push({ start, end });
    if (p.end < q.end) i++;
    else j++;
  }
  return out;
}

export function intersectAll(lists: Interval[][]): Interval[] {
  if (lists.length === 0) return [];
  return lists.slice(1).reduce((acc, l) => intersect(acc, l), merge(lists[0]!));
}

/** Parts of `a` not covered by `b`. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const cuts = merge(b);
  const out: Interval[] = [];
  for (const piece of merge(a)) {
    let cursor = piece.start;
    for (const c of cuts) {
      if (c.end <= cursor) continue;
      if (c.start >= piece.end) break;
      if (c.start > cursor) out.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
    }
    if (cursor < piece.end) out.push({ start: cursor, end: piece.end });
  }
  return out;
}

/** Free time inside `window` given busy blocks (any order, overlaps allowed). */
export function freeFrom(busy: Interval[], window: Interval): Interval[] {
  return subtract([window], busy);
}

/** Keep only intervals at least `ms` long. */
export function atLeast(list: Interval[], ms: Ms): Interval[] {
  return list.filter((i) => i.end - i.start >= ms);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dow: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zonedParts(ms: Ms, tz: string): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dow: WEEKDAYS.indexOf(map.weekday ?? ''),
  };
}

export function localParts(ms: Ms, tz: string): { hour: number; minute: number; dow: number; dateKey: string } {
  const p = zonedParts(ms, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { hour: p.hour, minute: p.minute, dow: p.dow, dateKey: `${p.year}-${pad(p.month)}-${pad(p.day)}` };
}

function offsetAt(ms: Ms, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d hour:00 (day may overflow, e.g. day 32). */
function zonedInstant(y: number, m: number, d: number, hour: number, tz: string): Ms {
  const wall = Date.UTC(y, m - 1, d, hour);
  let t = wall - offsetAt(wall, tz);
  t = wall - offsetAt(t, tz);
  return t;
}

/** Local calendar dates (as y/m/d) covering a window, with one day of padding on each side. */
function localDates(window: Interval, tz: string): { y: number; m: number; d: number }[] {
  const first = zonedParts(window.start, tz);
  const last = zonedParts(window.end, tz);
  const startDay = Date.UTC(first.year, first.month - 1, first.day) - DAY;
  const endDay = Date.UTC(last.year, last.month - 1, last.day) + DAY;
  const out: { y: number; m: number; d: number }[] = [];
  for (let t = startDay; t <= endDay; t += DAY) {
    const dt = new Date(t);
    out.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  }
  return out;
}

/** The instant the local calendar day containing `ms` begins in `tz`. */
export function startOfLocalDay(ms: Ms, tz: string): Ms {
  const p = zonedParts(ms, tz);
  return zonedInstant(p.year, p.month, p.day, 0, tz);
}

/** Blocks of quiet time (e.g. 22:00 to 08:00 local) clipped to the window. */
export function quietBlocks(window: Interval, tz: string, startHour: number, endHour: number): Interval[] {
  const blocks: Interval[] = [];
  for (const { y, m, d } of localDates(window, tz)) {
    const start = zonedInstant(y, m, d, startHour, tz);
    const end = startHour > endHour ? zonedInstant(y, m, d + 1, endHour, tz) : zonedInstant(y, m, d, endHour, tz);
    blocks.push({ start, end });
  }
  return intersect(merge(blocks), [window]);
}

/** Local evenings (default 17:00 to 22:00) inside the window. */
export function eveningWindows(window: Interval, tz: string, fromHour = 17, toHour = 22): Interval[] {
  const blocks: Interval[] = [];
  for (const { y, m, d } of localDates(window, tz)) {
    blocks.push({ start: zonedInstant(y, m, d, fromHour, tz), end: zonedInstant(y, m, d, toHour, tz) });
  }
  return intersect(merge(blocks), [window]);
}
