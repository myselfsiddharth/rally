import type { Occasion } from '../engine/tasks';
import { DAY, HOUR } from '../engine/time';
import type { CircleId, Interval, Ms, PersonId } from '../engine/types';
import { atLocal, phoenixMidnight } from './calendars';
import type { Cohort } from './personas';
import { createRng } from './rng';

export interface SimOccasion {
  id: string;
  /** When the agents notice it and the host is asked. */
  at: Ms;
  occasion: Occasion;
  circle: CircleId;
  honoree: PersonId | null;
  surprise: boolean;
  window: Interval;
  durationMs: Ms;
  title: string;
}

/** Monday 2026-10-19 00:00 Phoenix. */
export const SIM_START: Ms = Date.UTC(2026, 9, 19, 7);

/** A scripted timeline: every birthday in the span, Halloween for each circle, and a few concerts. */
export function makeWorld(seed: number, cohort: Cohort, weeks: number, start: Ms = SIM_START): SimOccasion[] {
  const rng = createRng(seed * 104729 + 7);
  const end = start + weeks * 7 * DAY;
  const out: SimOccasion[] = [];
  const primary = (id: PersonId) => cohort.personas.find((p) => p.id === id)!.circles[0]!;

  for (const p of cohort.personas) {
    if (p.birthdayDay === null) continue;
    const day = phoenixMidnight(start + p.birthdayDay * DAY);
    if (day >= end) continue;
    const noticed = Math.max(start + DAY, atLocal(day - 10 * DAY, 10));
    out.push({
      id: `bday-${p.id}`,
      at: noticed,
      occasion: 'birthday',
      circle: primary(p.id),
      honoree: p.id,
      surprise: rng.chance(0.5),
      window: { start: Math.max(noticed + DAY, day - 2 * DAY), end: day + 5 * DAY },
      durationMs: 3 * HOUR,
      title: `${p.name}'s birthday`,
    });
  }

  const halloween = phoenixMidnight(Date.UTC(2026, 9, 31, 12));
  if (halloween > start && halloween < end) {
    for (const circle of Object.keys(cohort.circles)) {
      out.push({
        id: `halloween-${circle}`,
        at: Math.max(start + DAY, atLocal(halloween - 10 * DAY, 10)),
        occasion: 'halloween',
        circle,
        honoree: null,
        surprise: false,
        window: { start: halloween - 2 * DAY, end: halloween + DAY },
        durationMs: 4 * HOUR,
        title: 'Halloween',
      });
    }
  }

  const circleIds = Object.keys(cohort.circles);
  const concertNames = ['Desert Echoes', 'The Cholla Kids', 'Saguaro Static'];
  for (let i = 0; i < 3 && weeks >= 3; i++) {
    const day = phoenixMidnight(start + (rng.int(10, Math.max(11, weeks * 7 - 2)) * DAY));
    const evening: Interval = { start: atLocal(day, 19), end: atLocal(day, 23) };
    out.push({
      id: `concert-${i + 1}`,
      at: Math.max(start + DAY, evening.start - 8 * DAY),
      occasion: 'concert',
      circle: rng.pick(circleIds),
      honoree: null,
      surprise: false,
      window: evening,
      durationMs: 4 * HOUR,
      title: concertNames[i]!,
    });
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}
