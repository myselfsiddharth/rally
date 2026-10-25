import { z } from 'zod';
import type { Interval, PersonId } from '../../engine/types';
import { CalendarError, type CalendarPort } from './port';

const API = 'https://www.googleapis.com/calendar/v3';

const FreeBusyResponse = z.object({
  calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })) })),
});
const InsertResponse = z.object({ id: z.string() });

export interface GoogleDeps {
  /** A valid access token for this student, or undefined if they have not connected. */
  accessToken(person: PersonId): Promise<string | undefined>;
  fetchFn?: typeof fetch;
}

/** Google Calendar over its REST API. Reads free/busy only; writes only events the student agreed to. */
export class GoogleCalendar implements CalendarPort {
  private fetchFn: typeof fetch;
  constructor(private deps: GoogleDeps) {
    this.fetchFn = deps.fetchFn ?? fetch;
  }

  async connected(person: PersonId): Promise<boolean> {
    return (await this.deps.accessToken(person)) !== undefined;
  }

  async kind(person: PersonId): Promise<'connected' | 'none'> {
    return (await this.connected(person)) ? 'connected' : 'none';
  }

  private async token(person: PersonId): Promise<string> {
    const t = await this.deps.accessToken(person);
    if (!t) throw new CalendarError('calendar not connected');
    return t;
  }

  async busy(person: PersonId, window: Interval): Promise<Interval[]> {
    const token = await this.token(person);
    const res = await this.fetchFn(`${API}/freeBusy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: new Date(window.start).toISOString(), timeMax: new Date(window.end).toISOString(), items: [{ id: 'primary' }] }),
    });
    if (!res.ok) throw new CalendarError(`Google free/busy failed with status ${res.status}`, res.status);
    const parsed = FreeBusyResponse.safeParse(await res.json());
    if (!parsed.success) throw new CalendarError('Google free/busy returned an unexpected response');
    const busy = parsed.data.calendars.primary?.busy ?? [];
    return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end));
  }

  async deleteEvent(person: PersonId, id: string): Promise<void> {
    const token = await this.token(person);
    const res = await this.fetchFn(`${API}/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new CalendarError(`Google event delete failed with status ${res.status}`, res.status);
  }

  async insertEvent(person: PersonId, event: { title: string; interval: Interval; description?: string }): Promise<{ id: string }> {
    const token = await this.token(person);
    const res = await this.fetchFn(`${API}/calendars/primary/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: { dateTime: new Date(event.interval.start).toISOString() },
        end: { dateTime: new Date(event.interval.end).toISOString() },
      }),
    });
    if (!res.ok) throw new CalendarError(`Google event insert failed with status ${res.status}`, res.status);
    const parsed = InsertResponse.safeParse(await res.json());
    if (!parsed.success) throw new CalendarError('Google event insert returned an unexpected response');
    return { id: parsed.data.id };
  }
}
