import { PrivateCalendar } from '../engine/protocol';
import { DAY, HOUR } from '../engine/time';
import type { Interval, Ms } from '../engine/types';
import type { Persona } from './personas';
import type { Rng } from './rng';

/** Phoenix has no daylight saving: local midnight is 07:00 UTC. */
export const phoenixMidnight = (utcMs: Ms): Ms => Math.floor((utcMs - 7 * HOUR) / DAY) * DAY + 7 * HOUR;
export const atLocal = (dayStart: Ms, hour: number): Ms => dayStart + hour * HOUR;

const ONE_OFFS = ['dentist', 'therapy', 'doctor', 'family dinner', 'job interview', 'club meeting', 'study group', 'volunteering'];

/**
 * Made-up weekly life: classes on MWF or TTh, some work shifts, study blocks and a few one-offs.
 * Labels are deliberately sensitive so the privacy tests have something real to protect.
 */
export function makeCalendar(rng: Rng, persona: Persona, window: Interval): PrivateCalendar {
  const events: { interval: Interval; label: string }[] = [];
  const classDays = rng.chance(0.5) ? [1, 3, 5] : [2, 4];
  const shiftDays = rng.chance(0.3) ? rng.shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, rng.int(2, 3)) : [];
  const first = phoenixMidnight(window.start);
  for (let day = first; day < window.end; day += DAY) {
    const dow = new Date(day + 7 * HOUR).getUTCDay();
    if (classDays.includes(dow)) {
      const blocks = rng.int(2, 3);
      let hour = rng.pick([8, 9, 10]);
      for (let b = 0; b < blocks; b++) {
        const len = rng.pick([1, 1.5]);
        events.push({ interval: { start: atLocal(day, hour), end: atLocal(day, hour + len) }, label: 'class' });
        hour += len + rng.pick([0.5, 1, 2]);
      }
    }
    if (shiftDays.includes(dow)) {
      const start = rng.pick([12, 16, 17]);
      events.push({ interval: { start: atLocal(day, start), end: atLocal(day, start + rng.pick([4, 5])) }, label: 'work shift' });
    }
    if (rng.chance(0.55)) {
      const start = rng.int(13, 19);
      events.push({ interval: { start: atLocal(day, start), end: atLocal(day, start + 2) }, label: 'study block' });
    }
    if (rng.chance(0.3)) {
      const start = rng.int(9, 20);
      events.push({ interval: { start: atLocal(day, start), end: atLocal(day, start + rng.int(1, 3)) }, label: rng.pick(ONE_OFFS) });
    }
  }
  void persona;
  return new PrivateCalendar(events.filter((e) => e.interval.end > window.start && e.interval.start < window.end));
}
