import type { PrivateCalendar } from '../../engine/protocol';
import { intersect } from '../../engine/time';
import type { Interval, PersonId } from '../../engine/types';
import { CalendarError, type CalendarPort } from './port';

/** A calendar port over made-up calendars, for the simulation and for tests. */
export class FakeCalendar implements CalendarPort {
  inserted: { person: PersonId; title: string; interval: Interval; description?: string }[] = [];
  constructor(
    private calendars: Record<PersonId, PrivateCalendar>,
    private disconnected: Set<PersonId> = new Set(),
  ) {}

  async connected(person: PersonId): Promise<boolean> {
    return person in this.calendars && !this.disconnected.has(person);
  }
  async busy(person: PersonId, window: Interval): Promise<Interval[]> {
    if (!(await this.connected(person))) throw new CalendarError('calendar not connected');
    return intersect(this.calendars[person]!.events.map((e) => e.interval), [window]);
  }
  async insertEvent(person: PersonId, event: { title: string; interval: Interval; description?: string }): Promise<{ id: string }> {
    if (!(await this.connected(person))) throw new CalendarError('calendar not connected');
    this.inserted.push({ person, ...event });
    this.calendars[person]!.events.push({ interval: event.interval, label: event.title });
    return { id: `fake-${this.inserted.length}` };
  }
}
