import { intersect } from '../../engine/time';
import { DAY, HOUR } from '../../engine/time';
import type { Interval, Ms, PersonId } from '../../engine/types';
import { phoenixMidnight } from '../../sim/calendars';
import { createRng } from '../../sim/rng';
import type { StorePort } from '../store/port';
import type { CalendarPort } from './port';

const hash = (s: string): number => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
};

/**
 * A made-up calendar for anyone who has not connected Google: classes, a few shifts and study blocks.
 * The same person always gets the same week, and events the agents add are remembered in the store.
 * It exists so the bot can be tried end to end without anyone's real calendar. Always say it is made up.
 */
export class DemoCalendar implements CalendarPort {
  constructor(private store: StorePort) {}

  readonly isDemo = true;

  async connected(): Promise<boolean> {
    return true;
  }

  async kind(): Promise<'demo'> {
    return 'demo';
  }

  private base(person: PersonId, window: Interval): Interval[] {
    const traits = createRng(hash(`traits:${person}`));
    const classDays = traits.chance(0.5) ? [1, 3, 5] : [2, 4];
    const shiftDays = traits.chance(0.3) ? [traits.int(0, 6), traits.int(0, 6)] : [];
    const out: Interval[] = [];
    for (let day = phoenixMidnight(window.start); day < window.end; day += DAY) {
      const rng = createRng(hash(`${person}:${day}`));
      const dow = new Date(day + 7 * HOUR).getUTCDay();
      if (classDays.includes(dow)) {
        let hour = rng.pick([8, 9, 10]);
        for (let b = rng.int(2, 3); b > 0; b--) {
          const len = rng.pick([1, 1.5]);
          out.push({ start: day + hour * HOUR, end: day + (hour + len) * HOUR });
          hour += len + rng.pick([0.5, 1, 2]);
        }
      }
      if (shiftDays.includes(dow)) {
        const start = rng.pick([12, 16, 17]);
        out.push({ start: day + start * HOUR, end: day + (start + rng.pick([4, 5])) * HOUR });
      }
      if (rng.chance(0.5)) {
        const start = rng.int(13, 19);
        out.push({ start: day + start * HOUR, end: day + (start + 2) * HOUR });
      }
    }
    return out;
  }

  async busy(person: PersonId, window: Interval): Promise<Interval[]> {
    const added = (await this.store.get<{ interval: Interval }[]>('demoevents', person)) ?? [];
    return intersect([...this.base(person, window), ...added.map((e) => e.interval)], [window]);
  }

  async insertEvent(person: PersonId, event: { title: string; interval: Interval; description?: string }): Promise<{ id: string }> {
    const added = (await this.store.get<{ title: string; interval: Interval }[]>('demoevents', person)) ?? [];
    added.push({ title: event.title, interval: event.interval });
    await this.store.put('demoevents', person, added);
    return { id: `demo-${person}-${added.length}` };
  }
}

export type { Ms };
