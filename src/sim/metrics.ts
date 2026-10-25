import type { PairPlan } from '../engine/pair';
import type { PartyPlan } from '../engine/party';
import type { Message } from '../engine/protocol';
import type { Ledger } from '../engine/tasks';
import { DAY } from '../engine/time';
import type { Interval, Ms, PersonId } from '../engine/types';
import type { PrivateCalendar } from '../engine/protocol';
import type { Persona } from './personas';
import type { SimOccasion } from './world';

export interface RawRun {
  messages: Message[];
  parties: PartyPlan[];
  pairs: PairPlan[];
  personas: Persona[];
  ledger: Ledger;
  attendance: { planId: string; going: number; attended: number }[];
  confirmed: { person: PersonId; interval: Interval; planId: string; counted: boolean }[];
  calendars: Record<PersonId, PrivateCalendar>;
  capBlocked: number;
  capGaveUp: number;
  folded: number;
  partyOccasions: Map<string, SimOccasion>;
}

export interface Metrics {
  partiesStarted: number;
  partiesCommitted: number;
  partiesNoSlot: number;
  partiesNeedingHost: number;
  partiesBlockedByCap: number;
  partiesGivenUpByCap: number;
  occasionsFolded: number;
  meanReadinessAtCommit: number;
  tasksReassigned: number;
  /** From someone declining a job to the replacement accepting it. */
  meanMinutesToRecover: number;
  attendanceRate: number;
  pairInvites: number;
  pairMeetups: number;
  pairAcceptRate: number;
  maxPairInvitesPerPersonPerWeek: number;
  /** Must be 0: two parties in one circle within 14 days, or a person over their invite caps. */
  capViolations: number;
  /** Must be 0: a private calendar label or dietary need found in any message. */
  labelLeaks: number;
  /** Must be 0: someone confirmed to two things at once, or to something over their own calendar. */
  doubleBookings: number;
  taskLoadGini: number;
  leftOutCount: number;
  messageCount: number;
}

export function gini(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || sum === 0) return 0;
  const weighted = xs.reduce((acc, x, i) => acc + (i + 1) * x, 0);
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Largest number of timestamps that fall inside any window of `span` milliseconds. */
function maxInWindow(times: Ms[], span: Ms): number {
  const xs = [...times].sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < xs.length; hi++) {
    while (xs[hi]! - xs[lo]! >= span) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export function computeMetrics(raw: RawRun): Metrics {
  const { messages, parties, pairs, personas } = raw;
  const started = parties.filter((p) => p.startedAt !== undefined);
  const committed = parties.filter((p) => p.status === 'committed');

  // Party cap, checked independently of the governor: parties that were not given back must be 14 days apart per circle.
  let capViolations = 0;
  const live = started.filter((p) => !['cancelled', 'no_slot'].includes(p.status));
  const perCircle = new Map<string, number[]>();
  for (const p of live) perCircle.set(p.circle, [...(perCircle.get(p.circle) ?? []), p.startedAt!]);
  for (const times of perCircle.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) if (times[i]! - times[i - 1]! < 14 * DAY) capViolations++;
  }

  // Pair caps: invites received per person, per rolling day and week, against their own limits.
  const asks = new Map<PersonId, Ms[]>();
  for (const m of messages) if (m.kind === 'PAIR_ASK') asks.set(m.to, [...(asks.get(m.to) ?? []), m.at]);
  let maxWeek = 0;
  for (const [person, times] of asks) {
    const limit = personas.find((p) => p.id === person)!.prefs;
    const week = maxInWindow(times, 7 * DAY);
    maxWeek = Math.max(maxWeek, week);
    if (week > limit.maxPairInvitesPerWeek) capViolations++;
    if (maxInWindow(times, DAY) > limit.maxPairInvitesPerDay) capViolations++;
  }

  // Privacy: scan every message for any private calendar label or dietary need.
  const secrets = new Set<string>();
  for (const cal of Object.values(raw.calendars)) for (const e of cal.events) if (!e.label.startsWith('hold:') && e.label !== 'class') secrets.add(e.label);
  for (const p of personas) for (const d of p.prefs.dietary) secrets.add(d);
  const text = JSON.stringify(messages).toLowerCase();
  let labelLeaks = 0;
  for (const s of secrets) if (text.includes(s.toLowerCase())) labelLeaks++;

  // Double bookings: confirmed things must not overlap each other or the person's own busy time.
  let doubleBookings = 0;
  const byPerson = new Map<PersonId, { interval: Interval; planId: string; counted: boolean }[]>();
  for (const c of raw.confirmed) byPerson.set(c.person, [...(byPerson.get(c.person) ?? []), c]);
  for (const [person, list] of byPerson) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) if (list[i]!.planId !== list[j]!.planId && overlaps(list[i]!.interval, list[j]!.interval)) doubleBookings++;
      if (!list[i]!.counted) continue;
      const own = raw.calendars[person]!.events.filter((e) => !e.label.startsWith('hold:'));
      if (own.some((e) => overlaps(e.interval, list[i]!.interval))) doubleBookings++;
    }
  }

  // Recovery speed: time from the owner declining a job to the replacement accepting the same job.
  const pendingSince = new Map<string, Ms>();
  const gaps: number[] = [];
  for (const m of messages) {
    const key = `${m.planId}:${String(m.body.taskId)}`;
    if (m.kind === 'TASK_DECLINE' && !pendingSince.has(key)) pendingSince.set(key, m.at);
    if (m.kind === 'TASK_ACCEPT' && pendingSince.has(key)) {
      gaps.push((m.at - pendingSince.get(key)!) / 60_000);
      pendingSince.delete(key);
    }
  }

  const commits = messages.filter((m) => m.kind === 'COMMIT');
  const readiness = [...new Map(commits.map((m) => [m.planId, Number(m.body.readiness)])).values()];
  const going = raw.attendance.reduce((a, b) => a + b.going, 0);
  const came = raw.attendance.reduce((a, b) => a + b.attended, 0);
  const pairAsksToA = pairs.filter((p) => p.status !== 'new');
  const pairConfirmed = pairs.filter((p) => p.status === 'confirmed');
  const loads = personas.map((p) => raw.ledger.load[p.id] ?? 0);

  return {
    partiesStarted: started.length,
    partiesCommitted: committed.length,
    partiesNoSlot: parties.filter((p) => p.status === 'no_slot').length,
    partiesNeedingHost: new Set(messages.filter((m) => m.kind === 'NEEDS_HOST').map((m) => m.planId)).size,
    partiesBlockedByCap: raw.capBlocked,
    partiesGivenUpByCap: raw.capGaveUp,
    occasionsFolded: raw.folded,
    meanReadinessAtCommit: readiness.length ? round(readiness.reduce((a, b) => a + b, 0) / readiness.length) : 0,
    tasksReassigned: parties.reduce((a, p) => a + p.reassigned, 0),
    meanMinutesToRecover: gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length, 1) : 0,
    attendanceRate: going ? round(came / going) : 0,
    pairInvites: pairAsksToA.length,
    pairMeetups: pairConfirmed.length,
    pairAcceptRate: pairAsksToA.length ? round(pairConfirmed.length / pairAsksToA.length) : 0,
    maxPairInvitesPerPersonPerWeek: maxWeek,
    capViolations,
    labelLeaks,
    doubleBookings,
    taskLoadGini: round(gini(loads)),
    leftOutCount: parties.reduce((a, p) => a + (p.slot?.leftOut.length ?? 0), 0),
    messageCount: messages.length,
  };
}

/** Problems that must never occur. An empty list means the run is clean. */
export function checkInvariants(m: Metrics): string[] {
  const problems: string[] = [];
  if (m.capViolations !== 0) problems.push(`cap violations: ${m.capViolations}`);
  if (m.labelLeaks !== 0) problems.push(`private labels leaked: ${m.labelLeaks}`);
  if (m.doubleBookings !== 0) problems.push(`double bookings: ${m.doubleBookings}`);
  if (m.maxPairInvitesPerPersonPerWeek > 2) problems.push(`someone got ${m.maxPairInvitesPerPersonPerWeek} pair invites in a week`);
  return problems;
}
