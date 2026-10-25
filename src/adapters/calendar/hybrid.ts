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
    return (await this.pick(person)).insertEvent(person, event);
  }
}
