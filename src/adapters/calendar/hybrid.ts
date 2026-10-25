import type { Interval, PersonId } from '../../engine/types';
import type { CalendarPort } from './port';

export type CalendarKind = 'connected' | 'demo';

/**
 * Real Google calendars for students who connected one, made-up demo calendars for everyone else, so a group
 * can be tried together while only some people have connected. Each person's kind is always reported honestly.
 */
export class HybridCalendar implements CalendarPort {
  constructor(
    private google: CalendarPort,
    private demo: CalendarPort,
  ) {}

  async kind(person: PersonId): Promise<CalendarKind> {
    return (await this.google.connected(person)) ? 'connected' : 'demo';
  }
  async connected(): Promise<boolean> {
    return true;
  }
  private async pick(person: PersonId): Promise<CalendarPort> {
    return (await this.google.connected(person)) ? this.google : this.demo;
  }
  async busy(person: PersonId, window: Interval): Promise<Interval[]> {
    return (await this.pick(person)).busy(person, window);
  }
  async insertEvent(person: PersonId, event: { title: string; interval: Interval; description?: string }): Promise<{ id: string }> {
    const real = await this.google.connected(person);
    const made = await (real ? this.google : this.demo).insertEvent(person, event);
    return { id: `${real ? 'g' : 'd'}:${made.id}` }; // remember which calendar holds it
  }
  /** Only real calendars have birthdays to learn from. */
  async birthdays(person: PersonId, window: Interval): Promise<{ name: string; month: number; day: number }[]> {
    return (await this.google.connected(person)) && this.google.birthdays ? this.google.birthdays(person, window) : [];
  }
  async deleteEvent(person: PersonId, id: string): Promise<void> {
    const [which, ...rest] = id.split(':');
    await (which === 'g' ? this.google : this.demo).deleteEvent(person, rest.join(':'));
  }
}
