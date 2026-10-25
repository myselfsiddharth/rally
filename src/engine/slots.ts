import type { Interval, Ms, PersonId, Prefs } from './types';
import { intersect, localParts, merge, quietBlocks, subtract, MINUTE } from './time';

export interface Candidate {
  id: PersonId;
  free: Interval[];
  prefs: Prefs;
}

export interface SlotOption {
  interval: Interval;
  attendees: PersonId[];
  leftOut: { id: PersonId; reason: 'no_overlap' }[];
  penalty: number;
}

export type SlotResult =
  | { kind: 'slots'; options: SlotOption[] }
  | { kind: 'none'; reason: 'no_overlap' | 'too_small' };

export interface SlotOptions {
  gridMs?: Ms;
  maxResults?: number;
  minAttendees?: number;
  preferEvening?: boolean;
}

/** Soft cost of a start time in the host's local time: weekday daytime and school nights cost more. */
function penaltyFor(start: Ms, tz: string, preferEvening: boolean): number {
  const { hour, dow } = localParts(start, tz);
  const schoolNight = dow >= 0 && dow <= 4; // Sun to Thu evenings come before a school day
  let cost = 0;
  if (preferEvening) {
    if (hour < 17 && !(dow === 6 || dow === 0)) cost += 3; // weekday daytime
    if (hour < 12 && (dow === 6 || dow === 0)) cost += 1; // too early on a weekend
    if (hour >= 17 && schoolNight) cost += 1;
    if (hour >= 21 && schoolNight) cost += 2;
  }
  return cost;
}

function covers(free: Interval[], slot: Interval): boolean {
  return free.some((f) => f.start <= slot.start && f.end >= slot.end);
}

/**
 * Find times when the most people can meet. Ordering: fewest left out, then lowest penalty, then earliest.
 * Options never overlap each other so the host sees real alternatives.
 */
export function findSlots(people: Candidate[], durationMs: Ms, window: Interval, opts: SlotOptions = {}): SlotResult {
  const gridMs = opts.gridMs ?? 30 * MINUTE;
  const maxResults = opts.maxResults ?? 5;
  const minAttendees = opts.minAttendees ?? 2;
  const preferEvening = opts.preferEvening ?? true;
  if (people.length < minAttendees) return { kind: 'none', reason: 'too_small' };

  const effective = people.map((p) => {
    const quiet = quietBlocks(window, p.prefs.tz, p.prefs.quietStartHour, p.prefs.quietEndHour);
    return { id: p.id, free: subtract(intersect(merge(p.free), [window]), quiet) };
  });
  const tz = people[0]!.prefs.tz;

  const all: SlotOption[] = [];
  const firstStart = Math.ceil(window.start / gridMs) * gridMs;
  for (let start = firstStart; start + durationMs <= window.end; start += gridMs) {
    const interval = { start, end: start + durationMs };
    const attendees: PersonId[] = [];
    const leftOut: SlotOption['leftOut'] = [];
    for (const p of effective) {
      if (covers(p.free, interval)) attendees.push(p.id);
      else leftOut.push({ id: p.id, reason: 'no_overlap' });
    }
    if (attendees.length >= minAttendees) all.push({ interval, attendees, leftOut, penalty: penaltyFor(start, tz, preferEvening) });
  }
  if (all.length === 0) return { kind: 'none', reason: 'no_overlap' };

  all.sort((a, b) => a.leftOut.length - b.leftOut.length || a.penalty - b.penalty || a.interval.start - b.interval.start);
  const chosen: SlotOption[] = [];
  for (const o of all) {
    if (chosen.every((c) => o.interval.end <= c.interval.start || o.interval.start >= c.interval.end)) chosen.push(o);
    if (chosen.length >= maxResults) break;
  }
  return { kind: 'slots', options: chosen };
}
