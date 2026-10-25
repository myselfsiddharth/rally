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
  /** Birthdays each person's Google Birthdays calendar would show, for tests. */
  birthdayFeeds: Record<PersonId, { name: string; month: number; day: number }[]> = {};
  async birthdays(person: PersonId): Promise<{ name: string; month: number; day: number }[]> {
    return this.birthdayFeeds[person] ?? [];
  }
  async kind(person: PersonId): Promise<'connected' | 'none'> {
    return (await this.connected(person)) ? 'connected' : 'none';
  }
  deleted: { person: PersonId; id: string }[] = [];
  async deleteEvent(person: PersonId, id: string): Promise<void> {
    const n = Number(id.replace('fake-', ''));
    const added = this.inserted[n - 1];
    if (added && added.person === person) {
      const cal = this.calendars[person]!;
      cal.events = cal.events.filter((e) => !(e.label === added.title && e.interval.start === added.interval.start && e.interval.end === added.interval.end));
    }
    this.deleted.push({ person, id });
  }
}
