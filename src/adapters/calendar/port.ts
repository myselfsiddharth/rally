import type { Interval, PersonId } from '../../engine/types';

export class CalendarError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** One student's calendar, as far as Rally may touch it: when they are busy, and adding an event they agreed to. */
export interface CalendarPort {
  /** False until the student has connected their calendar. */
  connected(person: PersonId): Promise<boolean>;
  /** Busy blocks only. Never titles or details. */
  busy(person: PersonId, window: Interval): Promise<Interval[]>;
  insertEvent(person: PersonId, event: { title: string; interval: Interval; description?: string }): Promise<{ id: string }>;
}
