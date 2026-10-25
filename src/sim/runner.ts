import { Governor } from '../engine/governor';
import { newPair, reducePair, type PairEvent, type PairPlan } from '../engine/pair';
import { proposePairs, sortedPairKey } from '../engine/pairs';
import { newParty, reduceParty, type PartyEvent, type PartyPlan } from '../engine/party';
import type { Message } from '../engine/protocol';
import type { Ledger } from '../engine/tasks';
import { DAY, HOUR, MINUTE, freeFrom, localParts } from '../engine/time';
import type { CircleId, Interval, Ms, PersonId, Prefs } from '../engine/types';
import { pAttend, pGhost, pHostAccepts, pPairYes, pRsvpYes, pTaskAccept } from './behaviors';
import { atLocal, makeCalendar, phoenixMidnight } from './calendars';
import { computeMetrics, type Metrics, type RawRun } from './metrics';
import { makePersonas, type Persona } from './personas';
import { createRng } from './rng';
import { SIM_START, makeWorld, type SimOccasion } from './world';

export interface SimOptions {
  seed: number;
  students: number;
  weeks: number;
  startMs?: Ms;
}

export interface SimNote {
  at: Ms;
  kind: 'occasion' | 'folded' | 'host_asked' | 'host_declined' | 'no_host' | 'cap_blocked' | 'cap_gave_up' | 'attended' | 'pair_met' | 'held';
  text: string;
  occasionId?: string;
}

export interface PartySummary {
  id: string;
  occasionId: string;
  title: string;
  occasion: string;
  circle: CircleId;
  status: PartyPlan['status'];
  reason?: string;
  startedAt?: Ms;
  slot?: Interval;
  attendees: PersonId[];
  leftOut: PersonId[];
  owners: Record<string, PersonId>;
  reassigned: number;
  honoree: PersonId | null;
  surprise: boolean;
}

export interface PairSummary {
  id: string;
  a: PersonId;
  b: PersonId;
  interval: Interval;
  status: PairPlan['status'];
}

export interface SimResult {
  /** Always 'simulation': this is generated data, never real. */
  label: 'simulation';
  seed: number;
  startMs: Ms;
  endMs: Ms;
  students: { id: PersonId; name: string; circles: CircleId[]; hasCar: boolean; canHost: boolean }[];
  circles: Record<CircleId, PersonId[]>;
  occasions: { id: string; title: string; occasion: string; circle: CircleId; at: Ms; window: Interval; honoree: PersonId | null }[];
  messages: Message[];
  notes: SimNote[];
  parties: PartySummary[];
  pairs: PairSummary[];
  /** Busy blocks with no labels, for the first two weeks, for drawing calendars. */
  busy: Record<PersonId, Interval[]>;
  metrics: Metrics;
}

interface Task {
  at: Ms;
  seq: number;
  fn: () => void;
}

/** A tiny binary-heap event queue. Ties break by insertion order so runs are reproducible. */
class Queue {
  private heap: Task[] = [];
  private seq = 0;
  push(at: Ms, fn: () => void): void {
    const t = { at, seq: this.seq++, fn };
    this.heap.push(t);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.heap[parent]!, this.heap[i]!)) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!];
      i = parent;
    }
  }
  pop(): Task | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.heap.length && this.less(this.heap[l]!, this.heap[m]!)) m = l;
        if (r < this.heap.length && this.less(this.heap[r]!, this.heap[m]!)) m = r;
        if (m === i) break;
        [this.heap[m], this.heap[i]] = [this.heap[i]!, this.heap[m]!];
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.heap.length;
  }
  private less(a: Task, b: Task): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
}

export function runSim(opts: SimOptions): SimResult {
  const start = opts.startMs ?? SIM_START;
  const end = start + opts.weeks * 7 * DAY;
  const cohort = makePersonas(opts.seed, opts.students, opts.weeks * 7);
  const world = makeWorld(opts.seed, cohort, opts.weeks, start);
  const rng = createRng(opts.seed * 2654435761 + 99);
  const byId = new Map<PersonId, Persona>(cohort.personas.map((p) => [p.id, p]));
  const prefs: Record<PersonId, Prefs> = Object.fromEntries(cohort.personas.map((p) => [p.id, p.prefs]));
  const calendars = Object.fromEntries(
    cohort.personas.map((p, i) => [p.id, makeCalendar(createRng(opts.seed * 31 + i * 17 + 3), p, { start, end: end + 14 * DAY })]),
  );

  const governor = new Governor();
  let ledger: Ledger = { load: {} };
  const queue = new Queue();
  const messages: Message[] = [];
  const notes: SimNote[] = [];
  const parties = new Map<string, PartyPlan>();
  const partyOccasion = new Map<string, SimOccasion>();
  const pairs = new Map<string, PairPlan>();
  const lastMet: Record<string, Ms> = {};
  const attendance: { planId: string; going: number; attended: number }[] = [];
  const confirmed: { person: PersonId; interval: Interval; planId: string; counted: boolean }[] = [];
  const holds = new Set<string>();
  const trimmed = new Set<string>();
  const capBlocked = new Set<string>();
  const capGaveUp = new Set<string>();
  const folded = new Set<string>();
  const hostFlagged = new Set<string>();
  const hostAsked = new Set<string>();
  const hosts = new Map<string, PersonId>();
  let evCounter = 0;
  let pairCounter = 0;
  let now = start;

  const note = (kind: SimNote['kind'], text: string, occasionId?: string) => notes.push({ at: now, kind, text, occasionId });
  const nameOf = (id: PersonId) => byId.get(id)?.name ?? id;

  /** Students answer only while awake: 08:00 to 22:00 Phoenix time. */
  const awake = (at: Ms, p: Persona): Ms => {
    const { hour } = localParts(at, p.prefs.tz);
    if (hour >= 8 && hour < 22) return at;
    const midnight = phoenixMidnight(at);
    return atLocal(hour < 8 ? midnight : midnight + DAY, 9) + rng.int(0, 45) * MINUTE;
  };
  const replyAt = (at: Ms, p: Persona): Ms => awake(at + rng.int(p.replyMinutes[0], p.replyMinutes[1]) * MINUTE, p);

  const addHold = (person: PersonId, planId: string, interval: Interval) => {
    calendars[person]!.events.push({ interval, label: `hold:${planId}` });
  };
  const releaseHolds = (planId: string, keep?: (person: PersonId) => boolean) => {
    for (const [person, cal] of Object.entries(calendars)) {
      if (keep?.(person)) continue;
      cal.events = cal.events.filter((e) => e.label !== `hold:${planId}`);
    }
  };

  // ---------------------------------------------------------------- parties

  function stepParty(planId: string, partial: Omit<PartyEvent, 'id' | 'at'>): void {
    const plan = parties.get(planId);
    const occ = partyOccasion.get(planId);
    if (!plan || !occ) return;
    const ev: PartyEvent = { ...partial, id: `${planId}:ev${evCounter++}`, at: now };
    const prev = plan.status;
    const step = reduceParty(plan, ev, { people: prefs, ledger, governor, window: occ.window, durationMs: occ.durationMs });
    parties.set(planId, step.plan);
    ledger = step.ledger;
    messages.push(...step.out);
    transitions(planId, occ, prev, step.plan);
    for (const m of step.out) routeParty(m, planId, occ);
  }

  function transitions(planId: string, occ: SimOccasion, prev: PartyPlan['status'], plan: PartyPlan): void {
    if (plan.status === 'collecting' && prev === 'new') {
      queue.push(now + 12 * HOUR, () => {
        if (parties.get(planId)?.status === 'collecting') stepParty(planId, { type: 'timeout' });
      });
    }
    if (plan.slot && !holds.has(planId)) {
      holds.add(planId);
      for (const who of plan.slot.attendees) addHold(who, planId, plan.slot.interval);
      note('held', `${plan.slot.attendees.length} calendars held for ${occ.title} while people answer`, occ.id);
      queue.push(now + 24 * HOUR, () => {
        if (parties.get(planId)?.status === 'proposed') stepParty(planId, { type: 'timeout' });
      });
    }
    if (plan.slot && !trimmed.has(planId) && ['assigning', 'needs_host', 'committed'].includes(plan.status)) {
      trimmed.add(planId);
      releaseHolds(planId, (who) => plan.rsvp[who] === 'yes');
    }
    if (plan.status === 'cancelled' || plan.status === 'no_slot') releaseHolds(planId);
    if (plan.status === 'committed' && prev !== 'committed') {
      const slot = plan.slot!;
      const going = plan.guests.filter((g) => plan.rsvp[g] === 'yes');
      for (const who of going) confirmed.push({ person: who, interval: slot.interval, planId, counted: slot.attendees.includes(who) });
      queue.push(slot.interval.end, () => {
        const attended = going.filter((g) => rng.chance(pAttend(byId.get(g)!)));
        attendance.push({ planId, going: going.length, attended: attended.length });
        for (let i = 0; i < attended.length; i++) {
          for (let j = i + 1; j < attended.length; j++) lastMet[sortedPairKey(attended[i]!, attended[j]!)] = now;
        }
        note('attended', `${attended.length} of ${going.length} came to ${occ.title}`, occ.id);
      });
    }
  }

  function routeParty(m: Message, planId: string, occ: SimOccasion): void {
    const target = byId.get(m.to);
    if (m.kind === 'ASK_AVAILABILITY' && target) {
      queue.push(now + MINUTE, () => {
        stepParty(planId, { type: 'availability', person: target.id, free: calendars[target.id]!.shared(target.id, occ.window).free });
      });
    } else if (m.kind === 'PROPOSE' && target) {
      if (rng.chance(pGhost(target))) return;
      const yes = rng.chance(pRsvpYes(target, Boolean(m.body.optional)));
      queue.push(replyAt(now, target), () => stepParty(planId, { type: yes ? 'rsvp_yes' : 'rsvp_no', person: target.id }));
    } else if (m.kind === 'TASK_OFFER' && target) {
      const taskId = String(m.body.taskId);
      const plan = parties.get(planId)!;
      const owned = Object.values(plan.tasks?.owner ?? {}).filter((o) => o === target.id).length;
      const ghost = rng.chance(pGhost(target));
      const yes = rng.chance(m.body.byHost ? 0.9 : pTaskAccept(target, Math.max(0, owned - 1)));
      if (!ghost) queue.push(replyAt(now, target), () => stepParty(planId, { type: yes ? 'task_accept' : 'task_decline', person: target.id, taskId }));
      queue.push(now + 24 * HOUR, () => {
        const p = parties.get(planId);
        if (p?.tasks && p.tasks.owner[taskId] === target.id && p.tasks.state[taskId] !== 'accepted') stepParty(planId, { type: 'task_decline', person: target.id, taskId });
      });
    } else if (m.kind === 'NEEDS_HOST' && target) {
      const taskId = String(m.body.taskId);
      const key = `${planId}:${taskId}`;
      if (hostFlagged.has(key)) return;
      hostFlagged.add(key);
      queue.push(replyAt(now, target), () => hostDecides(planId, taskId));
    }
  }

  function hostDecides(planId: string, taskId: string): void {
    const plan = parties.get(planId);
    if (!plan?.tasks || !['assigning', 'needs_host'].includes(plan.status)) return;
    const spec = plan.tasks.specs.find((s) => s.id === taskId);
    if (!spec) return;
    const going = plan.guests.filter((g) => plan.rsvp[g] === 'yes' && g !== plan.honoree);
    const eligible = going.filter((g) => {
      const pr = prefs[g]!;
      return (!spec.needs.car || pr.hasCar) && (!spec.needs.host || pr.canHost) && !(plan.tasks!.declinedBy[taskId] ?? []).includes(g);
    });
    // A job nobody can do: drop it if it is minor. If the venue has no host, the host picks a public place instead.
    const waivable = !spec.critical || spec.id === 'venue';
    if (waivable && (eligible.length === 0 ? spec.id !== 'venue' || rng.chance(0.85) : !spec.critical && rng.chance(0.6))) {
      return void stepParty(planId, { type: 'host_waive', person: plan.host, taskId });
    }
    if (eligible.length > 0) return void stepParty(planId, { type: 'host_assign', person: plan.host, taskId, target: rng.pick(eligible) });
    stepParty(planId, { type: 'cancel', person: plan.host });
  }

  /** The agents never start a plan the cap would refuse. They wait for it to clear, or fold the occasion into a nearby party. */
  function startOccasion(occ: SimOccasion, attempt: number): void {
    const planId = attempt === 0 ? occ.id : `${occ.id}#${attempt}`;
    const allowedAt = governor.nextPartyAllowedAt(occ.circle, now);
    if (allowedAt > now) {
      if (!capBlocked.has(occ.id)) {
        capBlocked.add(occ.id);
        note('cap_blocked', `${occ.title}: ${occ.circle} already has a party within 14 days, so the agents hold off`, occ.id);
      }
      const nearby = [...parties.values()].find(
        (p) => p.circle === occ.circle && p.slot && ['proposed', 'assigning', 'needs_host', 'committed'].includes(p.status) && p.slot.interval.start >= occ.window.start && p.slot.interval.start < occ.window.end,
      );
      if (nearby && !folded.has(occ.id)) {
        folded.add(occ.id);
        note('folded', `${occ.title} is celebrated at the party already planned for ${partyOccasion.get(nearby.id)?.title ?? nearby.id}`, occ.id);
        return;
      }
      const retryAt = atLocal(phoenixMidnight(allowedAt), 10) >= allowedAt ? atLocal(phoenixMidnight(allowedAt), 10) : atLocal(phoenixMidnight(allowedAt) + DAY, 10);
      const retry = Math.min(retryAt, now + 2 * DAY);
      if (retry + occ.durationMs <= occ.window.end) queue.push(retry, () => startOccasion(occ, attempt));
      else if (!capGaveUp.has(occ.id)) {
        capGaveUp.add(occ.id);
        note('cap_gave_up', `${occ.title}: the cap does not clear inside its window, so no second party`, occ.id);
      }
      return;
    }
    if (!hostAsked.has(occ.id)) {
      hostAsked.add(occ.id);
      note('occasion', `${occ.title} is coming up. Agents in ${occ.circle} start planning.`, occ.id);
    }
    const members = cohort.circles[occ.circle]!;
    let host = hosts.get(occ.id); // a host who already agreed stays host on a retry after the cap clears
    if (!host) {
      const candidates = rng.shuffle(members.filter((m) => m !== occ.honoree)).slice(0, 3);
      for (const c of candidates) {
        note('host_asked', `${nameOf(c)} is asked to host ${occ.title}`, occ.id);
        if (rng.chance(pHostAccepts(byId.get(c)!))) {
          host = c;
          break;
        }
        note('host_declined', `${nameOf(c)} says not this time`, occ.id);
      }
    }
    if (!host) return void note('no_host', `Nobody wanted to host ${occ.title}, so it is skipped`, occ.id);
    hosts.set(occ.id, host);
    const plan = newParty({ id: planId, circle: occ.circle, occasion: occ.occasion, host, honoree: occ.honoree, surprise: occ.surprise, guests: members });
    parties.set(planId, plan);
    partyOccasion.set(planId, occ);
    stepParty(planId, { type: 'start', person: host });
  }

  // ---------------------------------------------------------------- pairs

  function stepPair(pairId: string, type: PairEvent['type']): void {
    const plan = pairs.get(pairId);
    if (!plan) return;
    const prev = plan.status;
    const step = reducePair(plan, { id: `${pairId}:ev${evCounter++}`, at: now, type }, { governor });
    pairs.set(pairId, step.plan);
    messages.push(...step.out);
    if (prev === 'new' && step.plan.status === 'asking_a') {
      addHold(plan.a, pairId, plan.interval);
      addHold(plan.b, pairId, plan.interval);
      queue.push(now + 12 * HOUR, () => {
        const s = pairs.get(pairId)?.status;
        if (s === 'asking_a' || s === 'asking_b') stepPair(pairId, 'timeout');
      });
    }
    if (step.plan.status === 'dropped') releaseHolds(pairId);
    if (step.plan.status === 'confirmed' && prev !== 'confirmed') {
      confirmed.push({ person: plan.a, interval: plan.interval, planId: pairId, counted: true }, { person: plan.b, interval: plan.interval, planId: pairId, counted: true });
      queue.push(plan.interval.end, () => {
        if (rng.chance(pAttend(byId.get(plan.a)!) * pAttend(byId.get(plan.b)!))) {
          lastMet[sortedPairKey(plan.a, plan.b)] = now;
          note('pair_met', `${nameOf(plan.a)} and ${nameOf(plan.b)} had their hangout`);
        }
      });
    }
    for (const m of step.out) {
      if (m.kind !== 'PAIR_ASK') continue;
      const who = byId.get(m.to)!;
      const role = plan.a === who.id ? 'a' : 'b';
      if (rng.chance(pGhost(who))) continue;
      const recent = governor.recentInviteCount(who.id, now);
      const yes = rng.chance(pPairYes(who, recent));
      queue.push(replyAt(now, who), () => stepPair(pairId, `${role}_${yes ? 'yes' : 'no'}` as PairEvent['type']));
    }
  }

  function pairRound(): void {
    const window = { start: now, end: now + 7 * DAY };
    const people = cohort.personas.map((p) => ({ id: p.id, prefs: p.prefs, free: freeFrom(calendars[p.id]!.events.map((e) => e.interval), window) }));
    for (const prop of proposePairs({ people, lastMet, now, window, governor, areFriends: (a, b) => byId.get(a)!.circles.some((c) => byId.get(b)!.circles.includes(c)) })) {
      const id = `pair-${++pairCounter}`;
      pairs.set(id, newPair({ id, a: prop.a, b: prop.b, interval: prop.interval }));
      stepPair(id, 'start');
    }
  }

  // ---------------------------------------------------------------- schedule and run

  for (const occ of world) queue.push(occ.at, () => startOccasion(occ, 0));
  for (let day = start; day < end; day += DAY) {
    queue.push(atLocal(phoenixMidnight(day), 12), pairRound);
  }
  for (let wk = start + 7 * DAY; wk < end; wk += 7 * DAY) {
    queue.push(wk, () => {
      ledger = { load: Object.fromEntries(Object.entries(ledger.load).map(([k, v]) => [k, v * 0.7])) };
    });
  }

  for (let task = queue.pop(); task; task = queue.pop()) {
    if (task.at > end + 4 * DAY) break;
    now = task.at;
    task.fn();
  }

  // ---------------------------------------------------------------- result

  const partySummaries: PartySummary[] = [...parties.values()].map((p) => {
    const occ = partyOccasion.get(p.id)!;
    const owners: Record<string, PersonId> = {};
    for (const s of p.tasks?.specs ?? []) {
      const o = p.tasks!.owner[s.id];
      if (o && p.tasks!.state[s.id] === 'accepted') owners[s.id] = o;
    }
    return {
      id: p.id,
      occasionId: occ.id,
      title: occ.title,
      occasion: occ.occasion,
      circle: p.circle,
      status: p.status,
      reason: p.reason,
      startedAt: p.startedAt,
      slot: p.slot?.interval,
      attendees: p.guests.filter((g) => p.rsvp[g] === 'yes'),
      leftOut: p.slot?.leftOut.map((l) => l.id) ?? [],
      owners,
      reassigned: p.reassigned,
      honoree: p.honoree,
      surprise: p.surprise,
    };
  });
  const pairSummaries: PairSummary[] = [...pairs.values()].map((p) => ({ id: p.id, a: p.a, b: p.b, interval: p.interval, status: p.status }));

  const baseBusy: Record<PersonId, Interval[]> = {};
  for (const p of cohort.personas) {
    baseBusy[p.id] = calendars[p.id]!.events.filter((e) => !e.label.startsWith('hold:') && e.interval.start < end).map((e) => e.interval);
  }

  const raw: RawRun = {
    messages,
    parties: [...parties.values()],
    pairs: [...pairs.values()],
    personas: cohort.personas,
    ledger,
    attendance,
    confirmed,
    calendars,
    capBlocked: capBlocked.size,
    capGaveUp: capGaveUp.size,
    folded: folded.size,
    partyOccasions: partyOccasion,
  };

  return {
    label: 'simulation',
    seed: opts.seed,
    startMs: start,
    endMs: end,
    students: cohort.personas.map((p) => ({ id: p.id, name: p.name, circles: p.circles, hasCar: p.prefs.hasCar, canHost: p.prefs.canHost })),
    circles: cohort.circles,
    occasions: world.map((o) => ({ id: o.id, title: o.title, occasion: o.occasion, circle: o.circle, at: o.at, window: o.window, honoree: o.honoree })),
    messages,
    notes,
    parties: partySummaries,
    pairs: pairSummaries,
    busy: baseBusy,
    metrics: computeMetrics(raw),
  };
}
