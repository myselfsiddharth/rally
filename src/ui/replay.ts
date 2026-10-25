import type { Message } from '../engine/protocol';
import type { Interval } from '../engine/types';

export interface ReplayState {
  /** How many messages are visible. */
  shown: number;
  /** 0 to 1: weighted share of the plan's jobs that have an accepted owner. */
  readiness: number;
  /** Indices of the decline and the re-offer that follows it. */
  highlights: number[];
}

/** One plan's messages, in the order they happened. */
export function planMessages(all: Message[], planId: string): Message[] {
  return all.filter((m) => m.planId === planId);
}

/** What the viewer sees after `shown` messages of a plan's log. */
export function replayState(messages: Message[], shown: number): ReplayState {
  const count = Math.max(0, Math.min(messages.length, Math.floor(shown)));
  const weights = new Map<string, number>();
  const accepted = new Set<string>();
  let total = 0;
  let committed: number | null = null;
  const highlights: number[] = [];
  const pendingDecline = new Map<string, number>();

  for (let i = 0; i < count; i++) {
    const m = messages[i]!;
    const taskId = typeof m.body.taskId === 'string' ? m.body.taskId : '';
    if (m.kind === 'TASK_OFFER') {
      if (typeof m.body.weight === 'number') weights.set(taskId, m.body.weight);
      if (typeof m.body.totalWeight === 'number') total = m.body.totalWeight;
      const declined = pendingDecline.get(taskId);
      if (m.body.reassigned && declined !== undefined) {
        highlights.push(declined, i);
        pendingDecline.delete(taskId);
      }
    } else if (m.kind === 'TASK_ACCEPT') accepted.add(taskId);
    else if (m.kind === 'TASK_DECLINE') {
      accepted.delete(taskId);
      pendingDecline.set(taskId, i);
    } else if (m.kind === 'COMMIT' && typeof m.body.readiness === 'number') committed = m.body.readiness;
  }
  highlights.push(...pendingDecline.values());
  const sum = [...accepted].reduce((a, id) => a + (weights.get(id) ?? 0), 0);
  const readiness = committed ?? (total > 0 ? Math.min(1, sum / total) : 0);
  return { shown: count, readiness, highlights: [...new Set(highlights)].sort((a, b) => a - b) };
}

const REASONS: Record<string, string> = {
  party_cap: 'this friend circle already had a party in the last 14 days',
  no_overlap: 'there was no time that worked for enough people',
  too_small: 'too few people for a party',
  too_few: 'too few people said yes',
  host_declined: 'the host stepped back',
  host_cancelled: 'the host called it off',
};

const PHOENIX = 'America/Phoenix';

/** "Fri Oct 30, 5:00 to 8:00 pm" in Phoenix time. */
export function formatSlot(i: Interval): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, weekday: 'short', month: 'short', day: 'numeric' }).format(i.start);
  const time = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX, hour: 'numeric', minute: '2-digit' }).format(ms).replace(' ', '').toLowerCase();
  return `${day}, ${time(i.start)} to ${time(i.end)}`;
}

/** A short, friendly sentence for any protocol message. Names, never ids. */
export function describeMessage(m: Message, names: Record<string, string>): string {
  const n = (id: string) => (id === 'coordinator' ? 'The coordinator' : names[id] ?? id);
  const poss = (id: string) => `${n(id)}'s agent`;
  const task = String(m.body.label ?? m.body.taskId ?? 'a job').toLowerCase();
  const slot = m.body.interval as Interval | undefined;
  switch (m.kind) {
    case 'ASK_AVAILABILITY':
      return m.body.silent ? `Quietly asks ${poss(m.to)} when they are free (a surprise, so their student is not told)` : `Asks ${poss(m.to)} when their student is free`;
    case 'AVAILABILITY':
      return `${poss(m.from)} shares only when ${n(m.from)} is free, nothing else`;
    case 'PROPOSE':
      return m.body.optional
        ? `Offers ${n(m.to)} an optional spot: ${slot ? formatSlot(slot) : 'the proposed time'}`
        : `Proposes to ${n(m.to)}: ${slot ? formatSlot(slot) : 'a time'}`;
    case 'ACCEPT':
      return `${n(m.from)} says yes to the time`;
    case 'COUNTER':
      return `${n(m.from)} can't make it`;
    case 'TASK_OFFER':
      return m.body.reassigned ? `Reassigned: ${n(m.to)} is asked to ${task}` : m.body.byHost ? `The host asks ${n(m.to)} to ${task}` : `${n(m.to)} is asked to ${task}`;
    case 'TASK_ACCEPT':
      return `${n(m.from)} takes the ${String(m.body.taskId)} job`;
    case 'TASK_DECLINE':
      return `${n(m.from)} passes on the ${String(m.body.taskId)} job`;
    case 'NEEDS_HOST':
      return `Nobody can take "${task}", so the host is asked to decide`;
    case 'COMMIT':
      return `${n(m.to)} gets the locked plan: ${slot ? formatSlot(slot) : ''}`.trim();
    case 'CANCEL':
      return `Plan stopped: ${REASONS[String(m.body.reason)] ?? String(m.body.reason)}`;
    case 'PAIR_ASK':
      return `Asks ${n(m.to)} if they would like to hang out with ${n(String(m.body.with))} ${slot ? formatSlot(slot) : ''}`.trim();
    case 'PAIR_YES':
      return `It is on: ${n(m.to)} and ${n(String(m.body.with))} ${slot ? formatSlot(slot) : ''}`.trim();
    case 'PAIR_NO':
      return m.to === 'coordinator' ? `${n(m.from)} passes (the other person is never told)` : 'Not this time (no reason given)';
    default:
      return String(m.kind);
  }
}

export interface TicketJob {
  taskId: string;
  label: string;
  owner: string | null;
  state: 'offered' | 'accepted' | 'passed';
  /** People who passed on this job, oldest first. */
  passedBy: string[];
}

export interface TicketView {
  slot: Interval | null;
  jobs: TicketJob[];
  attendees: number;
  committed: boolean;
  cancelled: string | null;
}

/** The party ticket as it looks after `shown` messages: the time, and who holds each job. */
export function ticketView(messages: Message[], shown: number): TicketView {
  const count = Math.max(0, Math.min(messages.length, Math.floor(shown)));
  const jobs = new Map<string, TicketJob>();
  let slot: Interval | null = null;
  let committed = false;
  let cancelled: string | null = null;
  const yes = new Set<string>();
  for (let i = 0; i < count; i++) {
    const m = messages[i]!;
    const taskId = typeof m.body.taskId === 'string' ? m.body.taskId : '';
    if (m.kind === 'PROPOSE' && !slot && m.body.interval) slot = m.body.interval as Interval;
    if (m.kind === 'ACCEPT') yes.add(m.from);
    if (m.kind === 'TASK_OFFER') {
      const prev = jobs.get(taskId);
      jobs.set(taskId, { taskId, label: String(m.body.label ?? taskId), owner: m.to, state: 'offered', passedBy: prev?.passedBy ?? [] });
    } else if (m.kind === 'TASK_ACCEPT') {
      const j = jobs.get(taskId);
      if (j) jobs.set(taskId, { ...j, state: 'accepted' });
    } else if (m.kind === 'TASK_DECLINE') {
      const j = jobs.get(taskId);
      if (j) jobs.set(taskId, { ...j, state: 'passed', passedBy: [...j.passedBy, m.from] });
    } else if (m.kind === 'COMMIT') committed = true;
    else if (m.kind === 'CANCEL') cancelled = String(m.body.reason ?? 'stopped');
  }
  return { slot, jobs: [...jobs.values()], attendees: yes.size + (slot ? 1 : 0), committed, cancelled };
}
