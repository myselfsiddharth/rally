import { z } from 'zod';
import { freeFrom } from './time';
import type { Interval, Ms, PersonId } from './types';

export const MESSAGE_KINDS = [
  'ASK_AVAILABILITY',
  'AVAILABILITY',
  'PROPOSE',
  'ACCEPT',
  'COUNTER',
  'TASK_OFFER',
  'TASK_ACCEPT',
  'TASK_DECLINE',
  'COMMIT',
  'PAIR_ASK',
  'PAIR_YES',
  'PAIR_NO',
  'CANCEL',
  'NEEDS_HOST',
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const MessageSchema = z.object({
  id: z.string(),
  planId: z.string(),
  at: z.number(),
  from: z.string(),
  to: z.string(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.record(z.string(), z.unknown()),
});

/** One thing one agent says to another (or to its own student). Bodies never carry private labels. */
export type Message = z.infer<typeof MessageSchema>;

/** The only calendar information an agent ever shares: when its student is free. There is no field for a label. */
export interface SharedFreeBusy {
  person: PersonId;
  free: Interval[];
}

/** A student's real calendar as their own agent sees it. Labels stay here. */
export class PrivateCalendar {
  constructor(public events: { interval: Interval; label: string }[] = []) {}

  shared(person: PersonId, window: Interval): SharedFreeBusy {
    return { person, free: freeFrom(this.events.map((e) => e.interval), window) };
  }
}

export function msg(planId: string, seq: number, at: Ms, from: Message['from'], to: Message['to'], kind: MessageKind, body: Record<string, unknown> = {}): Message {
  return { id: `${planId}:${seq}`, planId, at, from, to, kind, body };
}
