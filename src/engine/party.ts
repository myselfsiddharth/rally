import type { Governor } from './governor';
import { msg, type Message } from './protocol';
import { findSlots, type SlotOption } from './slots';
import {
  accept,
  assign,
  canCommit,
  decline,
  groupNotes,
  needsHost,
  readiness,
  templateFor,
  type Ledger,
  type Occasion,
  type PlanTasks,
} from './tasks';
import type { CircleId, Interval, Ms, PersonId, Prefs } from './types';

export type PartyStatus = 'new' | 'collecting' | 'proposed' | 'assigning' | 'needs_host' | 'committed' | 'cancelled' | 'no_slot';

export interface PartyPlan {
  id: string;
  circle: CircleId;
  occasion: Occasion;
  host: PersonId;
  honoree: PersonId | null;
  surprise: boolean;
  guests: PersonId[];
  status: PartyStatus;
  reason?: string;
  startedAt?: Ms;
  availability: Record<PersonId, Interval[]>;
  slot?: SlotOption;
  rsvp: Record<PersonId, 'yes' | 'no'>;
  tasks?: PlanTasks;
  reassigned: number;
  hostNotified: string[];
  seen: string[];
  seq: number;
}

export type PartyEvent = {
  id: string;
  at: Ms;
  type: 'start' | 'availability' | 'timeout' | 'rsvp_yes' | 'rsvp_no' | 'task_accept' | 'task_decline' | 'host_waive' | 'host_assign' | 'cancel';
  person?: PersonId;
  taskId?: string;
  target?: PersonId;
  free?: Interval[];
};

export interface PartyContext {
  people: Record<PersonId, Prefs>;
  ledger: Ledger;
  governor: Governor;
  window: Interval;
  durationMs: Ms;
}

export interface PartyStep {
  plan: PartyPlan;
  out: Message[];
  ledger: Ledger;
}

export function newParty(p: { id: string; circle: CircleId; occasion: Occasion; host: PersonId; honoree?: PersonId | null; surprise?: boolean; guests: PersonId[] }): PartyPlan {
  const guests = [...new Set([p.host, ...p.guests, ...(p.honoree ? [p.honoree] : [])])];
  return {
    id: p.id,
    circle: p.circle,
    occasion: p.occasion,
    host: p.host,
    honoree: p.honoree ?? null,
    surprise: Boolean(p.surprise && p.honoree),
    guests,
    status: 'new',
    availability: {},
    rsvp: {},
    reassigned: 0,
    hostNotified: [],
    seen: [],
    seq: 0,
  };
}

const TERMINAL: PartyStatus[] = ['committed', 'cancelled', 'no_slot'];
const FOOD = new Set(['cake', 'drinks', 'snacks']);

/** The state machine for one party. Pure apart from the shared governor; duplicate event ids change nothing. */
export function reduceParty(plan: PartyPlan, ev: PartyEvent, ctx: PartyContext): PartyStep {
  if (plan.seen.includes(ev.id)) return { plan, out: [], ledger: ctx.ledger };
  const p: PartyPlan = structuredClone(plan);
  p.seen.push(ev.id);
  const out: Message[] = [];
  let ledger = ctx.ledger;

  const say = (to: string, kind: Message['kind'], body: Record<string, unknown> = {}, from = 'coordinator') => {
    out.push(msg(p.id, p.seq++, ev.at, from, to, kind, body));
  };
  const visibleTo = (id: PersonId) => !(p.surprise && id === p.honoree);
  const done = () => ({ plan: p, out, ledger });
  const ignore = () => ({ plan, out: [] as Message[], ledger: ctx.ledger });
  const peopleFor = (ids: PersonId[]) => ids.map((id) => ({ id, prefs: ctx.people[id]! }));
  const attendeesNow = () => p.guests.filter((g) => p.rsvp[g] === 'yes');

  const end = (status: PartyStatus, reason: string, notify: PersonId[]) => {
    p.status = status;
    p.reason = reason;
    if (p.startedAt !== undefined) ctx.governor.releaseParty(p.circle, p.startedAt);
    for (const who of notify) if (visibleTo(who)) say(who, 'CANCEL', { reason });
  };

  const flagHost = () => {
    if (!p.tasks) return;
    for (const id of needsHost(p.tasks)) {
      if (p.hostNotified.includes(id)) continue;
      p.hostNotified.push(id);
      say(p.host, 'NEEDS_HOST', { taskId: id, label: p.tasks.specs.find((s) => s.id === id)?.label });
    }
  };

  const refresh = () => {
    const tasks = p.tasks!;
    if (canCommit(tasks)) {
      p.status = 'committed';
      const next: Ledger = { load: { ...ledger.load } };
      const owners: Record<string, string> = {};
      for (const spec of tasks.specs) {
        const owner = tasks.owner[spec.id];
        if (owner && tasks.state[spec.id] === 'accepted') {
          owners[spec.id] = owner;
          next.load[owner] = (next.load[owner] ?? 0) + spec.weight;
        }
      }
      ledger = next;
      for (const who of attendeesNow()) if (visibleTo(who)) say(who, 'COMMIT', { interval: p.slot!.interval, owners, readiness: readiness(tasks) });
      return;
    }
    flagHost();
    p.status = needsHost(tasks).length > 0 ? 'needs_host' : 'assigning';
  };

  const advance = () => {
    const yes = attendeesNow();
    if (yes.length < 2) return end('cancelled', 'too_few', p.guests);
    p.tasks = assign(templateFor(p.occasion), peopleFor(yes), ledger, p.honoree ? [p.honoree] : []);
    p.status = 'assigning';
    const notes = groupNotes(peopleFor(yes));
    for (const spec of p.tasks.specs) {
      const owner = p.tasks.owner[spec.id];
      if (owner) say(owner, 'TASK_OFFER', { taskId: spec.id, label: spec.label, notes: FOOD.has(spec.id) ? notes : [] });
    }
    refresh();
  };

  const propose = () => {
    const responders = p.guests.filter((g) => p.availability[g]).map((g) => ({ id: g, free: p.availability[g]!, prefs: ctx.people[g]! }));
    const res = findSlots(responders, ctx.durationMs, ctx.window);
    const options = res.kind === 'slots' ? res.options.filter((o) => o.attendees.includes(p.host) && (!p.surprise || o.attendees.includes(p.honoree!))) : [];
    if (options.length === 0) {
      return end('no_slot', res.kind === 'none' ? res.reason : 'no_overlap', [p.host]);
    }
    const best = structuredClone(options[0]!);
    for (const g of p.guests) if (!p.availability[g]) best.leftOut.push({ id: g, reason: 'no_overlap' });
    p.slot = best;
    p.status = 'proposed';
    p.rsvp[p.host] = 'yes';
    if (p.surprise) p.rsvp[p.honoree!] = 'yes';
    const leftOutIds = best.leftOut.map((l) => l.id);
    for (const who of best.attendees) if (who !== p.host && visibleTo(who)) say(who, 'PROPOSE', { interval: best.interval, leftOut: leftOutIds });
    for (const who of leftOutIds) if (visibleTo(who)) say(who, 'PROPOSE', { interval: best.interval, optional: true });
    if (best.attendees.every((a) => p.rsvp[a])) advance();
  };

  switch (ev.type) {
    case 'start': {
      if (p.status !== 'new') return ignore();
      if (p.guests.length < 3) {
        end('no_slot', 'too_small', [p.host]);
        return done();
      }
      const verdict = ctx.governor.canStartParty(p.circle, ev.at);
      if (!verdict.ok) {
        end('cancelled', verdict.reason, [p.host]);
        return done();
      }
      ctx.governor.recordParty(p.circle, ev.at);
      p.startedAt = ev.at;
      p.status = 'collecting';
      for (const g of p.guests) say(g, 'ASK_AVAILABILITY', { window: ctx.window, durationMs: ctx.durationMs, silent: !visibleTo(g) });
      return done();
    }
    case 'availability': {
      if (p.status !== 'collecting' || !ev.person || !p.guests.includes(ev.person) || p.availability[ev.person]) return ignore();
      p.availability[ev.person] = ev.free ?? [];
      say('coordinator', 'AVAILABILITY', { freeWindows: p.availability[ev.person]!.length }, ev.person);
      if (p.guests.every((g) => p.availability[g])) propose();
      return done();
    }
    case 'timeout': {
      if (p.status === 'collecting') propose();
      else if (p.status === 'proposed') advance();
      else return ignore();
      return done();
    }
    case 'rsvp_yes':
    case 'rsvp_no': {
      if (p.status !== 'proposed' || !ev.person || !p.guests.includes(ev.person) || p.rsvp[ev.person]) return ignore();
      p.rsvp[ev.person] = ev.type === 'rsvp_yes' ? 'yes' : 'no';
      say('coordinator', ev.type === 'rsvp_yes' ? 'ACCEPT' : 'COUNTER', {}, ev.person);
      if (ev.type === 'rsvp_no' && ev.person === p.host) {
        end('cancelled', 'host_declined', p.guests);
        return done();
      }
      if (p.slot!.attendees.every((a) => p.rsvp[a])) advance();
      return done();
    }
    case 'task_accept': {
      if (!['assigning', 'needs_host'].includes(p.status) || !p.tasks || !ev.person || !ev.taskId) return ignore();
      const next = accept(p.tasks, ev.taskId, ev.person);
      if (next === p.tasks) return ignore();
      p.tasks = next;
      say('coordinator', 'TASK_ACCEPT', { taskId: ev.taskId }, ev.person);
      refresh();
      return done();
    }
    case 'task_decline': {
      if (!['assigning', 'needs_host'].includes(p.status) || !p.tasks || !ev.person || !ev.taskId) return ignore();
      const before = p.tasks.owner[ev.taskId];
      const next = decline(p.tasks, ev.taskId, ev.person, peopleFor(attendeesNow()), ledger, p.honoree ? [p.honoree] : []);
      if (next === p.tasks) return ignore();
      p.tasks = next;
      say('coordinator', 'TASK_DECLINE', { taskId: ev.taskId }, ev.person);
      const owner = next.owner[ev.taskId];
      if (before === ev.person && owner) {
        p.reassigned++;
        say(owner, 'TASK_OFFER', { taskId: ev.taskId, label: next.specs.find((s) => s.id === ev.taskId)?.label, reassigned: true });
      }
      refresh();
      return done();
    }
    case 'host_waive': {
      if (!['assigning', 'needs_host'].includes(p.status) || !p.tasks || ev.person !== p.host || !ev.taskId) return ignore();
      const t = p.tasks;
      p.tasks = {
        ...t,
        specs: t.specs.filter((s) => s.id !== ev.taskId),
        owner: Object.fromEntries(Object.entries(t.owner).filter(([k]) => k !== ev.taskId)),
        backup: Object.fromEntries(Object.entries(t.backup).filter(([k]) => k !== ev.taskId)),
        state: Object.fromEntries(Object.entries(t.state).filter(([k]) => k !== ev.taskId)),
        declinedBy: Object.fromEntries(Object.entries(t.declinedBy).filter(([k]) => k !== ev.taskId)),
      };
      refresh();
      return done();
    }
    case 'host_assign': {
      if (!['assigning', 'needs_host'].includes(p.status) || !p.tasks || ev.person !== p.host || !ev.taskId || !ev.target) return ignore();
      if (!attendeesNow().includes(ev.target) || ev.target === p.honoree) return ignore();
      p.tasks = { ...p.tasks, owner: { ...p.tasks.owner, [ev.taskId]: ev.target }, state: { ...p.tasks.state, [ev.taskId]: 'offered' } };
      say(ev.target, 'TASK_OFFER', { taskId: ev.taskId, label: p.tasks.specs.find((s) => s.id === ev.taskId)?.label, byHost: true });
      refresh();
      return done();
    }
    case 'cancel': {
      if (TERMINAL.includes(p.status) || ev.person !== p.host) return ignore();
      end('cancelled', 'host_cancelled', p.guests.filter((g) => g !== p.host));
      return done();
    }
  }
}
