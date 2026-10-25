import type { CalendarPort } from '../adapters/calendar/port';
import type { Button, PlatformPort } from '../adapters/platform/port';
import type { StorePort } from '../adapters/store/port';
import { Governor, type GovernorSnapshot } from '../engine/governor';
import { newPair, reducePair, type PairEvent, type PairPlan } from '../engine/pair';
import { proposePairs, sortedPairKey } from '../engine/pairs';
import { newParty, reduceParty, type PartyEvent, type PartyPlan } from '../engine/party';
import type { Message } from '../engine/protocol';
import type { Ledger, Occasion } from '../engine/tasks';
import { DAY, HOUR, freeFrom, localParts, startOfLocalDay } from '../engine/time';
import { DEFAULT_PREFS, type CircleId, type Interval, type Ms, type PersonId, type Prefs } from '../engine/types';
import { REASONS, say } from './text';

export interface PersonRecord {
  id: PersonId;
  name: string;
  prefs: Prefs;
  birthday?: { month: number; day: number };
  paused: boolean;
}

export interface CircleRecord {
  id: CircleId;
  name: string;
  channelId: string;
  code: string;
  members: PersonId[];
  owner: PersonId;
}

export interface PartyRecord {
  plan: PartyPlan;
  window: Interval;
  durationMs: Ms;
  title: string;
  proposedAt?: Ms;
  offeredAt: Record<string, Ms>;
  /** The calendar event we added for each person, so it can be removed if they back out. */
  eventIds?: Record<PersonId, string>;
  reminded?: boolean;
}

export interface PairRecord {
  plan: PairPlan;
  askedAt?: Ms;
  eventIds?: Record<PersonId, string>;
  reminded?: boolean;
}

export interface OfferRecord {
  key: string;
  circle: CircleId;
  occasion: Occasion;
  honoree: PersonId | null;
  surprise: boolean;
  title: string;
  window: Interval;
  durationMs: Ms;
  candidates: PersonId[];
  index: number;
  state: 'asking' | 'waiting' | 'started' | 'dropped';
  host?: PersonId;
}

export interface OutboxItem {
  id: string;
  person: PersonId;
  text: string;
  buttons?: Button[];
  queuedAt: Ms;
}

export interface Deps {
  store: StorePort;
  calendar: CalendarPort;
  platform: PlatformPort;
  now: () => Ms;
  /** Optional: make a fixed message sound warmer. Must return the original on any problem. */
  polish?: (text: string) => Promise<string>;
}

export type StartResult = { ok: true; planId: string } | { ok: false; reason: 'party_cap' | 'unknown_circle' | 'not_a_member' | 'too_small'; nextAt?: Ms };

/** Demo friends are fictional circle members whose agents answer on their own, so one person can see a whole plan. */
export const DEMO_PREFIX = 'demo:';
export const isDemoPerson = (id: PersonId): boolean => id.startsWith(DEMO_PREFIX);
const DEMO_FRIENDS: { id: PersonId; name: string; prefs: Partial<Prefs> }[] = [
  { id: 'demo:maya', name: 'Maya (demo)', prefs: { hasCar: true } },
  { id: 'demo:omar', name: 'Omar (demo)', prefs: { canHost: true } },
  { id: 'demo:priya', name: 'Priya (demo)', prefs: { hasCar: true, budget: 'high' } },
];
const REMIND_BEFORE = 24 * HOUR;

const COLLECT_TIMEOUT = 12 * HOUR;
const RSVP_TIMEOUT = 24 * HOUR;
const JOB_TIMEOUT = 24 * HOUR;
const PAIR_TIMEOUT = 12 * HOUR;

const OCCASION_LENGTH: Record<Occasion, Ms> = { birthday: 3 * HOUR, halloween: 4 * HOUR, concert: 4 * HOUR, hangout: 2 * HOUR };

/** Connects the planning engine to calendars, chat and storage. Every state change goes through the engine's reducers. */
export class Orchestrator {
  constructor(private d: Deps) {}

  // ------------------------------------------------------------ people and circles

  async ensurePerson(id: PersonId, name: string): Promise<PersonRecord> {
    const existing = await this.d.store.get<PersonRecord>('person', id);
    if (existing) return existing;
    const rec: PersonRecord = { id, name, prefs: { ...DEFAULT_PREFS }, paused: false };
    await this.d.store.put('person', id, rec);
    return rec;
  }

  async person(id: PersonId): Promise<PersonRecord | undefined> {
    return this.d.store.get<PersonRecord>('person', id);
  }

  async updatePrefs(id: PersonId, patch: Partial<Prefs>): Promise<PersonRecord | undefined> {
    const rec = await this.person(id);
    if (!rec) return undefined;
    const next = { ...rec, prefs: { ...rec.prefs, ...patch } };
    await this.d.store.put('person', id, next);
    return next;
  }

  async setBirthday(id: PersonId, month: number, day: number): Promise<boolean> {
    const rec = await this.person(id);
    if (!rec || month < 1 || month > 12 || day < 1 || day > 31) return false;
    await this.d.store.put('person', id, { ...rec, birthday: { month, day } });
    return true;
  }

  async setPaused(id: PersonId, paused: boolean): Promise<void> {
    const rec = await this.person(id);
    if (rec) await this.d.store.put('person', id, { ...rec, paused });
  }

  /**
   * Delete everything Rally keeps about someone: their record, calendar connection, circle membership, held and failed
   * messages, coffee plans, demo events and invite history. Parties other people are in stay, with this person's id
   * replaced by "removed", so nobody else's plan breaks.
   */
  async forget(id: PersonId): Promise<void> {
    const quoted = JSON.stringify(id);
    for (const c of await this.d.store.list<CircleRecord>('circle')) {
      if (c.members.includes(id)) await this.d.store.put('circle', c.id, { ...c, members: c.members.filter((m) => m !== id) });
    }
    for (const ns of ['token', 'person', 'demoevents', 'oauthstate']) await this.d.store.del(ns, id);
    for (const ns of ['outbox', 'undelivered']) {
      for (const item of await this.d.store.list<{ id: string; person: PersonId }>(ns)) if (item.person === id) await this.d.store.del(ns, item.id);
    }
    for (const pair of await this.d.store.list<PairRecord>('pair')) {
      if (pair.plan.a === id || pair.plan.b === id) await this.d.store.del('pair', pair.plan.id);
    }
    for (const party of await this.d.store.list<PartyRecord>('party')) {
      const json = JSON.stringify(party);
      if (json.includes(quoted)) await this.d.store.put('party', party.plan.id, JSON.parse(json.split(quoted).join('"removed"')));
    }
    for (const offer of await this.d.store.list<OfferRecord>('offer')) {
      const json = JSON.stringify(offer);
      if (json.includes(quoted)) await this.d.store.put('offer', offer.key, JSON.parse(json.split(quoted).join('"removed"')));
    }
    const met = (await this.d.store.get<Record<string, Ms>>('meta', 'lastMet')) ?? {};
    await this.d.store.put('meta', 'lastMet', Object.fromEntries(Object.entries(met).filter(([k]) => !k.split('|').includes(id))));
    const gov = await this.d.store.get<GovernorSnapshot>('meta', 'governor');
    if (gov) {
      delete gov.invites[id];
      gov.declines = Object.fromEntries(Object.entries(gov.declines).filter(([k]) => !k.split('|').includes(id)));
      await this.d.store.put('meta', 'governor', gov);
    }
  }

  async createCircle(channelId: string, owner: PersonId, name: string): Promise<CircleRecord> {
    const n = await this.counter('circle');
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const rec: CircleRecord = { id: `c${n}`, name, channelId, code, members: [owner], owner };
    await this.d.store.put('circle', rec.id, rec);
    return rec;
  }

  async joinCircle(code: string, person: PersonId): Promise<CircleRecord | undefined> {
    const circle = (await this.d.store.list<CircleRecord>('circle')).find((c) => c.code === code.trim().toUpperCase());
    if (!circle) return undefined;
    if (!circle.members.includes(person)) circle.members.push(person);
    await this.d.store.put('circle', circle.id, circle);
    return circle;
  }

  async circlesOf(person: PersonId): Promise<CircleRecord[]> {
    return (await this.d.store.list<CircleRecord>('circle')).filter((c) => c.members.includes(person));
  }

  async status(person: PersonId): Promise<string> {
    const rec = await this.person(person);
    if (!rec) return 'You have not joined anything yet. Use /rally join with a code from a friend.';
    const parties = (await this.d.store.list<PartyRecord>('party')).filter((p) => p.plan.guests.includes(person) && !['cancelled', 'no_slot'].includes(p.plan.status));
    const kind = this.d.calendar.kind ? await this.d.calendar.kind(person) : (await this.d.calendar.connected(person)) ? 'connected' : 'none';
    const lines = [`Calendar: ${kind === 'demo' ? 'demo (a made-up calendar, not yours; use /rally connect for your real one)' : kind === 'connected' ? 'connected (only your busy and free times are used)' : 'not connected (use /rally connect)'}`, `Quiet hours: ${rec.prefs.quietStartHour}:00 to ${rec.prefs.quietEndHour}:00`, `Coffee invites: at most ${rec.prefs.maxPairInvitesPerWeek} a week`];
    for (const p of parties.slice(-4)) lines.push(`${p.title}: ${p.plan.status.replace('_', ' ')}`);
    return lines.join('\n');
  }

  // ------------------------------------------------------------ shared state

  private async counter(name: string): Promise<number> {
    const n = ((await this.d.store.get<number>('meta', `counter-${name}`)) ?? 0) + 1;
    await this.d.store.put('meta', `counter-${name}`, n);
    return n;
  }
  private async governor(): Promise<Governor> {
    return Governor.fromJSON((await this.d.store.get<GovernorSnapshot>('meta', 'governor')) ?? { parties: {}, invites: {}, declines: {} });
  }
  private async saveGovernor(g: Governor): Promise<void> {
    await this.d.store.put('meta', 'governor', g.toJSON());
  }
  private async ledger(): Promise<Ledger> {
    return (await this.d.store.get<Ledger>('meta', 'ledger')) ?? { load: {} };
  }
  private async lastMet(): Promise<Record<string, Ms>> {
    return (await this.d.store.get<Record<string, Ms>>('meta', 'lastMet')) ?? {};
  }
  private async markMet(people: PersonId[], at: Ms): Promise<void> {
    const met = await this.lastMet();
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) met[sortedPairKey(people[i]!, people[j]!)] = at;
    await this.d.store.put('meta', 'lastMet', met);
  }
  private async prefsOf(ids: PersonId[]): Promise<Record<PersonId, Prefs>> {
    const out: Record<PersonId, Prefs> = {};
    for (const id of ids) out[id] = (await this.person(id))?.prefs ?? { ...DEFAULT_PREFS };
    return out;
  }
  private async nameOf(id: PersonId): Promise<string> {
    return (await this.person(id))?.name ?? 'a friend';
  }
  private async tzOf(id: PersonId): Promise<string> {
    return (await this.person(id))?.prefs.tz ?? DEFAULT_PREFS.tz;
  }
  /** Add three fictional friends to a circle. Their agents answer by themselves, and they are always labelled (demo). */
  async addDemoFriends(circleId: CircleId, forPerson: PersonId): Promise<string[]> {
    const circle = await this.d.store.get<CircleRecord>('circle', circleId);
    if (!circle) return [];
    const tz = await this.tzOf(forPerson);
    for (const f of DEMO_FRIENDS) {
      if (!(await this.person(f.id))) await this.d.store.put('person', f.id, { id: f.id, name: f.name, prefs: { ...DEFAULT_PREFS, tz, ...f.prefs }, paused: false } satisfies PersonRecord);
      if (!circle.members.includes(f.id)) circle.members.push(f.id);
    }
    await this.d.store.put('circle', circle.id, circle);
    return DEMO_FRIENDS.map((f) => f.name);
  }

  /** A demo friend answers straight away. Omar passes on the first job he is offered, to show the hand-over. */
  private async demoAnswer(person: PersonId, text: string, buttons: Button[] = []): Promise<void> {
    const find = (re: RegExp) => buttons.find((b) => re.test(b.id));
    let pick = find(/^offer:.*:go$/) ?? find(/:rsvp_yes$/) ?? find(/^pair:.*:yes$/);
    const accept = find(/:task_accept:/);
    const pass = find(/:task_decline:/);
    if (!pick && accept && pass) {
      const key = `${accept.id.split(':')[1]}:${person}`;
      const first = person === 'demo:omar' && !text.startsWith('Someone had to drop') && !(await this.d.store.get('demostate', key));
      if (first) await this.d.store.put('demostate', key, true);
      pick = first ? pass : accept;
    }
    pick ??= find(/:host_waive:/);
    if (pick) await this.handleButton(person, pick.id);
  }

  /** Send a direct message, or hold it until morning if it is the student's quiet time. */
  private async send(person: PersonId, text: string, buttons?: Button[]): Promise<void> {
    if (isDemoPerson(person)) return this.demoAnswer(person, text, buttons);
    const prefs = (await this.person(person))?.prefs ?? DEFAULT_PREFS;
    if (!new Governor().canDisturb(prefs, this.d.now()).ok) {
      const id = `${this.d.now()}-${await this.counter('outbox')}`;
      await this.d.store.put<OutboxItem>('outbox', id, { id, person, text, buttons, queuedAt: this.d.now() });
      return;
    }
    const line = this.d.polish ? await this.d.polish(text) : text;
    await this.deliver(person, line, buttons);
  }

  /** One person whose DMs are closed must never stop a plan for everyone else, so failures are recorded, not thrown. */
  private async deliver(person: PersonId, text: string, buttons?: Button[]): Promise<void> {
    try {
      await this.d.platform.dm(person, text, buttons);
    } catch (e) {
      const id = `${this.d.now()}-${await this.counter('undelivered')}`;
      await this.d.store.put('undelivered', id, { id, person, at: this.d.now(), reason: e instanceof Error ? e.message.slice(0, 120) : 'failed' });
    }
  }

  /** Deliver held messages to anyone whose quiet hours have ended. */
  private async flushOutbox(now: Ms): Promise<number> {
    let sent = 0;
    for (const item of await this.d.store.list<OutboxItem>('outbox')) {
      const prefs = (await this.person(item.person))?.prefs ?? DEFAULT_PREFS;
      if (!new Governor().canDisturb(prefs, now).ok) continue;
      await this.d.store.del('outbox', item.id);
      const line = this.d.polish ? await this.d.polish(item.text) : item.text;
      await this.deliver(item.person, line, item.buttons);
      sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------ parties

  /** Start a party now, if the 14-day cap allows. The caller has the host's yes. */
  async startParty(p: { circle: CircleId; host: PersonId; occasion: Occasion; honoree?: PersonId | null; surprise?: boolean; title: string; window?: Interval; durationMs?: Ms; key?: string }): Promise<StartResult> {
    const circle = await this.d.store.get<CircleRecord>('circle', p.circle);
    if (!circle) return { ok: false, reason: 'unknown_circle' };
    if (!circle.members.includes(p.host)) return { ok: false, reason: 'not_a_member' };
    if (circle.members.length < 3) return { ok: false, reason: 'too_small' };
    const now = this.d.now();
    const governor = await this.governor();
    if (!governor.canStartParty(circle.id, now).ok) return { ok: false, reason: 'party_cap', nextAt: governor.nextPartyAllowedAt(circle.id, now) };

    const hostTz = await this.tzOf(p.host);
    const today = startOfLocalDay(now, hostTz);
    const window = p.window ?? { start: now + 2 * HOUR, end: today + 8 * DAY };
    const planId = p.key ?? `party-${await this.counter('party')}`;
    const plan = newParty({ id: planId, circle: circle.id, occasion: p.occasion, host: p.host, honoree: p.honoree ?? null, surprise: p.surprise, guests: circle.members });
    const rec: PartyRecord = { plan, window, durationMs: p.durationMs ?? OCCASION_LENGTH[p.occasion], title: p.title, offeredAt: {} };
    await this.d.store.put('party', planId, rec);
    await this.dispatchParty(planId, { id: `${planId}:start`, type: 'start', person: p.host });
    return { ok: true, planId };
  }

  private async dispatchParty(planId: string, partial: Omit<PartyEvent, 'at'>): Promise<void> {
    const rec = await this.d.store.get<PartyRecord>('party', planId);
    if (!rec) return;
    const now = this.d.now();
    const governor = await this.governor();
    const ledger = await this.ledger();
    const prev = rec.plan.status;
    const step = reduceParty(rec.plan, { ...partial, at: now }, { people: await this.prefsOf(rec.plan.guests), ledger, governor, window: rec.window, durationMs: rec.durationMs });
    rec.plan = step.plan;
    if (step.plan.status === 'proposed' && prev !== 'proposed') rec.proposedAt = now;
    for (const m of step.out) if (m.kind === 'TASK_OFFER') rec.offeredAt[String(m.body.taskId)] = now;
    await this.d.store.put('party', planId, rec);
    await this.d.store.put('meta', 'ledger', step.ledger);
    await this.saveGovernor(governor);
    for (const m of step.out) await this.deliverParty(rec, m);
    if (prev !== 'committed' && step.plan.status === 'committed' && step.plan.lockedAt === now && !step.plan.surprise) await this.announce(rec);
  }

  /** Tell the whole friend circle in its channel once a plan locks in. Never for a surprise. */
  private async announce(rec: PartyRecord): Promise<void> {
    const { plan } = rec;
    if (!plan.slot || !plan.tasks) return;
    const host = await this.person(plan.host);
    const lines: string[] = [];
    for (const spec of plan.tasks.specs) {
      const owner = plan.tasks.owner[spec.id];
      if (owner && plan.tasks.state[spec.id] === 'accepted') lines.push(`${await this.nameOf(owner)}: ${spec.label}`);
    }
    try {
      await this.d.platform.post(plan.circle, say.channelPlan(rec.title, plan.slot.interval, host?.prefs.tz ?? DEFAULT_PREFS.tz, lines));
    } catch {
      /* the channel may be gone or the bot muted; the DMs already went out */
    }
  }

  private async deliverParty(rec: PartyRecord, m: Message): Promise<void> {
    const planId = rec.plan.id;
    const tz = m.to !== 'coordinator' && m.to !== 'circle' ? await this.tzOf(m.to) : DEFAULT_PREFS.tz;
    const slot = m.body.interval as Interval | undefined;
    switch (m.kind) {
      case 'ASK_AVAILABILITY':
        return this.answerAvailability(rec, m.to);
      case 'PROPOSE':
        return this.send(m.to, say.propose(await this.nameOf(rec.plan.host), rec.title, slot!, tz, Boolean(m.body.optional)), [
          { id: `party:${planId}:rsvp_yes`, label: m.body.optional ? 'Come anyway' : "I'm in", style: 'primary' },
          { id: `party:${planId}:rsvp_no`, label: "Can't make it", style: 'secondary' },
        ]);
      case 'TASK_OFFER': {
        const taskId = String(m.body.taskId);
        return this.send(m.to, say.taskOffer(rec.title, String(m.body.label ?? taskId), (m.body.notes as string[] | undefined) ?? [], Boolean(m.body.reassigned)), [
          { id: `party:${planId}:task_accept:${taskId}`, label: "I'll take it", style: 'primary' },
          { id: `party:${planId}:task_decline:${taskId}`, label: 'Pass', style: 'secondary' },
        ]);
      }
      case 'NEEDS_HOST': {
        const taskId = String(m.body.taskId);
        return this.send(m.to, say.needsHost(rec.title, String(m.body.label ?? taskId)), [
          { id: `party:${planId}:host_waive:${taskId}`, label: 'Skip it', style: 'secondary' },
          { id: `party:${planId}:cancel`, label: 'Call it off', style: 'danger' },
        ]);
      }
      case 'COMMIT': {
        if (m.body.update) return this.send(m.to, say.commit(rec.title, slot!, tz, false).replace('is locked in', 'is back on'));
        const added = await this.addToCalendar(m.to, rec.title, slot!, `Planned with Rally`);
        if (added.id) await this.rememberEvent('party', planId, m.to, added.id);
        await this.markMet(rec.plan.guests.filter((g) => rec.plan.rsvp[g] === 'yes'), slot!.end);
        return this.send(m.to, added.result === 'overlap' ? say.overlap(rec.title) : say.commit(rec.title, slot!, tz, added.result === 'added'), [
          { id: `party:${planId}:withdraw`, label: "Can't come anymore", style: 'danger' },
        ]);
      }
      case 'WITHDREW': {
        const handed = ((m.body.handed as { label?: string; to: string | null }[] | undefined) ?? []).map((h) => ({ label: h.label ?? 'a job', to: h.to }));
        const named = await Promise.all(handed.map(async (h) => ({ label: h.label, to: h.to ? await this.nameOf(h.to) : null })));
        return this.send(m.to, say.withdrewHost(await this.nameOf(String(m.body.person)), rec.title, named));
      }
      case 'CANCEL':
        return this.send(m.to, say.cancelled(rec.title, REASONS[String(m.body.reason)] ?? String(m.body.reason)));
      default:
        return; // messages to the coordinator are the agents talking to each other
    }
  }

  /** The agent answers for its student by itself: only free time leaves the calendar. */
  private async answerAvailability(rec: PartyRecord, person: PersonId): Promise<void> {
    let free: Interval[] = [];
    if (await this.d.calendar.connected(person)) {
      try {
        free = freeFrom(await this.d.calendar.busy(person, rec.window), rec.window);
      } catch {
        free = [];
      }
    } else if (!rec.plan.surprise || person !== rec.plan.honoree) {
      await this.send(person, say.needCalendar(rec.title));
    }
    await this.dispatchParty(rec.plan.id, { id: `${rec.plan.id}:avail:${person}`, type: 'availability', person, free });
  }

  private async addToCalendar(person: PersonId, title: string, interval: Interval, description: string): Promise<{ result: 'added' | 'overlap' | 'not_connected'; id?: string }> {
    if (!(await this.d.calendar.connected(person))) return { result: 'not_connected' };
    try {
      const busy = await this.d.calendar.busy(person, interval);
      if (busy.length > 0) return { result: 'overlap' };
      const made = await this.d.calendar.insertEvent(person, { title, interval, description });
      return { result: 'added', id: made.id };
    } catch {
      return { result: 'not_connected' };
    }
  }

  /** Remember which calendar event belongs to whom, so backing out can remove it. */
  private async rememberEvent(ns: 'party' | 'pair', planId: string, person: PersonId, eventId: string): Promise<void> {
    const rec = await this.d.store.get<PartyRecord | PairRecord>(ns, planId);
    if (!rec) return;
    rec.eventIds = { ...(rec.eventIds ?? {}), [person]: eventId };
    await this.d.store.put(ns, planId, rec);
  }

  /** Take someone's event for a plan off their calendar. Never fails the caller. */
  private async removeEvent(ns: 'party' | 'pair', planId: string, person: PersonId): Promise<void> {
    const rec = await this.d.store.get<PartyRecord | PairRecord>(ns, planId);
    const id = rec?.eventIds?.[person];
    if (!rec || !id) return;
    try {
      await this.d.calendar.deleteEvent(person, id);
    } catch {
      /* the event may already be gone, or the calendar disconnected; backing out still counts */
    }
    const rest = { ...(rec.eventIds ?? {}) };
    delete rest[person];
    rec.eventIds = rest;
    await this.d.store.put(ns, planId, rec);
  }

  // ------------------------------------------------------------ pairs

  private async dispatchPair(pairId: string, type: PairEvent['type'], eventId: string, person?: PersonId): Promise<void> {
    const rec = await this.d.store.get<PairRecord>('pair', pairId);
    if (!rec) return;
    const now = this.d.now();
    const governor = await this.governor();
    const step = reducePair(rec.plan, { id: eventId, at: now, type, person }, { governor });
    rec.plan = step.plan;
    if (type === 'start' && step.out.length > 0) rec.askedAt = now;
    await this.d.store.put('pair', pairId, rec);
    await this.saveGovernor(governor);
    for (const m of step.out) {
      const tz = m.to !== 'coordinator' ? await this.tzOf(m.to) : DEFAULT_PREFS.tz;
      const slot = m.body.interval as Interval | undefined;
      const other = m.body.with ? await this.nameOf(String(m.body.with)) : '';
      if (m.kind === 'PAIR_ASK') {
        await this.send(m.to, say.pairAsk(other, slot!, tz), [
          { id: `pair:${pairId}:yes`, label: "I'm in", style: 'primary' },
          { id: `pair:${pairId}:no`, label: 'Not this time', style: 'secondary' },
        ]);
      } else if (m.kind === 'PAIR_YES') {
        const added = await this.addToCalendar(m.to, `Coffee with ${other}`, slot!, 'Set up by Rally');
        if (added.id) await this.rememberEvent('pair', pairId, m.to, added.id);
        await this.send(m.to, say.pairYes(other, slot!, tz, added.result === 'added'), [{ id: `pair:${pairId}:cancel`, label: "Can't make it anymore", style: 'danger' }]);
        await this.markMet([m.to, String(m.body.with)], slot!.end);
      } else if (m.kind === 'WITHDREW') {
        await this.removeEvent('pair', pairId, m.to);
        await this.send(m.to, say.withdrewPair(await this.nameOf(String(m.body.person))));
      } else if (m.kind === 'PAIR_NO' && m.to !== 'coordinator') {
        await this.send(m.to, say.pairNo());
      }
    }
  }

  // ------------------------------------------------------------ buttons

  /** Handle a button press. Returns the short acknowledgement the student sees. */
  async handleButton(actor: PersonId, customId: string): Promise<string> {
    const [kind, id, action, arg] = customId.split(':');
    const eventId = `btn:${customId}:${actor}`;
    if (kind === 'party' && id && action) {
      const rec = await this.d.store.get<PartyRecord>('party', id);
      if (!rec || !rec.plan.guests.includes(actor)) return 'That plan is not yours.';
      const types: Record<string, PartyEvent['type']> = { rsvp_yes: 'rsvp_yes', rsvp_no: 'rsvp_no', task_accept: 'task_accept', task_decline: 'task_decline', host_waive: 'host_waive', cancel: 'cancel', withdraw: 'withdraw' };
      const type = types[action];
      if (!type) return 'That button is not recognised.';
      await this.dispatchParty(id, { id: eventId, type, person: actor, taskId: arg });
      if (type === 'withdraw') {
        await this.removeEvent('party', id, actor);
        const after = await this.d.store.get<PartyRecord>('party', id);
        if (after?.plan.status === 'cancelled') for (const g of after.plan.guests) await this.removeEvent('party', id, g);
        return say.withdrawAck();
      }
      return { rsvp_yes: "Great, you're in.", rsvp_no: 'No problem, thanks for letting me know.', task_accept: 'Thanks, it is yours.', task_decline: 'Okay, I will find someone else.', host_waive: 'Skipped.', cancel: 'Called off.' }[action] ?? 'Done.';
    }
    if (kind === 'pair' && id && action) {
      const rec = await this.d.store.get<PairRecord>('pair', id);
      if (!rec || (rec.plan.a !== actor && rec.plan.b !== actor)) return 'That invitation is not yours.';
      if (action === 'cancel') {
        await this.dispatchPair(id, 'withdraw', eventId, actor);
        await this.removeEvent('pair', id, actor);
        return say.withdrawAck();
      }
      const role = rec.plan.a === actor ? 'a' : 'b';
      await this.dispatchPair(id, `${role}_${action === 'yes' ? 'yes' : 'no'}` as PairEvent['type'], eventId);
      return action === 'yes' ? 'Nice. I will let you know when it is confirmed.' : 'No problem.';
    }
    if (kind === 'offer' && id && action) return this.answerOffer(actor, id, action === 'go');
    return 'That button is not recognised.';
  }

  // ------------------------------------------------------------ occasions

  private async answerOffer(actor: PersonId, key: string, go: boolean): Promise<string> {
    const offer = await this.d.store.get<OfferRecord>('offer', key);
    if (!offer || offer.state === 'dropped' || offer.state === 'started') return 'That one is already handled.';
    if (offer.candidates[offer.index] !== actor) return 'That one was offered to someone else.';
    if (!go) {
      offer.index += 1;
      if (offer.index >= offer.candidates.length) offer.state = 'dropped';
      await this.d.store.put('offer', key, offer);
      if (offer.state === 'asking') await this.askHost(offer);
      return 'No problem, I will ask someone else.';
    }
    offer.host = actor;
    const result = await this.startParty({ circle: offer.circle, host: actor, occasion: offer.occasion, honoree: offer.honoree, surprise: offer.surprise, title: offer.title, window: offer.window, durationMs: offer.durationMs, key });
    if (result.ok) {
      offer.state = 'started';
      await this.d.store.put('offer', key, offer);
      return 'On it. I am checking everyone\'s calendars.';
    }
    if (result.reason === 'party_cap') {
      offer.state = 'waiting';
      await this.d.store.put('offer', key, offer);
      const tz = await this.tzOf(actor);
      await this.send(actor, say.hostWaiting(offer.title, formatDay(result.nextAt!, tz)));
      return 'Okay, I will start it when the 14-day gap is over.';
    }
    return 'I could not start that one.';
  }

  private async askHost(offer: OfferRecord): Promise<void> {
    const host = offer.candidates[offer.index];
    if (!host) return;
    await this.send(host, say.hostOffer(offer.title), [
      { id: `offer:${offer.key}:go`, label: 'Yes, plan it', style: 'primary' },
      { id: `offer:${offer.key}:pass`, label: 'Not me', style: 'secondary' },
    ]);
  }

  /** Look for occasions that need a plan and ask a likely host. Safe to run repeatedly. */
  private async findOccasions(now: Ms): Promise<number> {
    let created = 0;
    const circles = await this.d.store.list<CircleRecord>('circle');
    const people = new Map((await this.d.store.list<PersonRecord>('person')).map((p) => [p.id, p]));
    const ask = async (offer: OfferRecord) => {
      if (await this.d.store.get('offer', offer.key)) return;
      await this.d.store.put('offer', offer.key, offer);
      created++;
      await this.askHost(offer);
    };
    const candidatesFor = (circle: CircleRecord, honoree: PersonId | null) =>
      circle.members
        .filter((m) => m !== honoree && people.get(m) && !people.get(m)!.paused)
        .sort((a, b) => Number(people.get(b)!.prefs.canHost) - Number(people.get(a)!.prefs.canHost) || (a < b ? -1 : 1));

    for (const circle of circles) {
      if (circle.members.length < 3) continue;
      for (const member of circle.members) {
        const rec = people.get(member);
        if (!rec?.birthday) continue;
        const tz = rec.prefs.tz;
        const year = Number(localParts(now, tz).dateKey.slice(0, 4));
        const midnightOf = (y: number) => startOfLocalDay(Date.UTC(y, rec.birthday!.month - 1, rec.birthday!.day, 12), tz);
        const day = midnightOf(year) + 2 * DAY < now ? midnightOf(year + 1) : midnightOf(year);
        const until = (day - now) / DAY;
        if (until > 14 || until < -2) continue;
        const candidates = candidatesFor(circle, member);
        if (candidates.length === 0) continue;
        await ask({
          key: `bday-${member}-${circle.id}-${new Date(day).getUTCFullYear()}`,
          circle: circle.id, occasion: 'birthday', honoree: member, surprise: false, title: `${rec.name}'s birthday`,
          window: { start: Math.max(now + 12 * HOUR, day - 2 * DAY), end: day + 5 * DAY }, durationMs: OCCASION_LENGTH.birthday, candidates, index: 0, state: 'asking',
        });
      }
      const first = people.get(circle.members[0]!);
      const tz = first?.prefs.tz ?? DEFAULT_PREFS.tz;
      const p = localParts(now, tz);
      const year = Number(p.dateKey.slice(0, 4));
      if (p.dateKey >= `${year}-10-17` && p.dateKey <= `${year}-10-31`) {
        const halloween = startOfLocalDay(Date.UTC(year, 9, 31, 12), tz);
        const candidates = candidatesFor(circle, null);
        if (candidates.length > 0) {
          await ask({
            key: `halloween-${circle.id}-${year}`, circle: circle.id, occasion: 'halloween', honoree: null, surprise: false, title: 'Halloween',
            window: { start: Math.max(now + 12 * HOUR, halloween - 2 * DAY), end: halloween + DAY }, durationMs: OCCASION_LENGTH.halloween, candidates, index: 0, state: 'asking',
          });
        }
      }
    }
    // hosts who said yes while the cap was in force: start as soon as it clears
    for (const offer of await this.d.store.list<OfferRecord>('offer')) {
      if (offer.state !== 'waiting' || !offer.host) continue;
      if (now + offer.durationMs > offer.window.end) {
        offer.state = 'dropped';
        await this.d.store.put('offer', offer.key, offer);
        continue;
      }
      const r = await this.startParty({ circle: offer.circle, host: offer.host, occasion: offer.occasion, honoree: offer.honoree, surprise: offer.surprise, title: offer.title, window: { start: Math.max(offer.window.start, now + 2 * HOUR), end: offer.window.end }, durationMs: offer.durationMs, key: offer.key });
      if (r.ok) {
        offer.state = 'started';
        await this.d.store.put('offer', offer.key, offer);
      }
    }
    return created;
  }

  // ------------------------------------------------------------ the periodic tick

  /**
   * Run every few minutes. Idempotent: running it twice at the same moment changes nothing the second time.
   * It times out slow plans, offers new occasions to hosts, and runs one round of coffee matching a day.
   */
  async tick(): Promise<{ timeouts: number; offers: number; pairs: number; delivered: number; reminders: number }> {
    const now = this.d.now();
    let timeouts = 0;
    const delivered = await this.flushOutbox(now);
    for (const rec of await this.d.store.list<PartyRecord>('party')) {
      const { plan } = rec;
      if (plan.status === 'collecting' && plan.startedAt !== undefined && now - plan.startedAt >= COLLECT_TIMEOUT) {
        await this.dispatchParty(plan.id, { id: `${plan.id}:to-collect`, type: 'timeout' });
        timeouts++;
      } else if (plan.status === 'proposed' && rec.proposedAt !== undefined && now - rec.proposedAt >= RSVP_TIMEOUT) {
        await this.dispatchParty(plan.id, { id: `${plan.id}:to-rsvp`, type: 'timeout' });
        timeouts++;
      } else if ((plan.status === 'assigning' || plan.status === 'needs_host') && plan.tasks) {
        for (const spec of plan.tasks.specs) {
          const owner = plan.tasks.owner[spec.id];
          const offered = rec.offeredAt[spec.id];
          if (owner && plan.tasks.state[spec.id] === 'offered' && offered !== undefined && now - offered >= JOB_TIMEOUT) {
            await this.dispatchParty(plan.id, { id: `${plan.id}:to-job:${spec.id}:${owner}:${offered}`, type: 'task_decline', person: owner, taskId: spec.id });
            timeouts++;
          }
        }
      }
    }
    for (const rec of await this.d.store.list<PairRecord>('pair')) {
      const s = rec.plan.status;
      if ((s === 'asking_a' || s === 'asking_b') && rec.askedAt !== undefined && now - rec.askedAt >= PAIR_TIMEOUT) {
        await this.dispatchPair(rec.plan.id, 'timeout', `${rec.plan.id}:to-pair`);
        timeouts++;
      }
    }
    const offers = await this.findOccasions(now);
    const pairs = await this.pairRound(now);
    const reminders = await this.sendReminders(now);
    return { timeouts, offers, pairs, delivered, reminders };
  }

  /** One reminder, the day before, for every plan that is on. Plans that already started are skipped, not reminded late. */
  private async sendReminders(now: Ms): Promise<number> {
    let sent = 0;
    for (const rec of await this.d.store.list<PartyRecord>('party')) {
      const slot = rec.plan.slot?.interval;
      if (rec.plan.status !== 'committed' || !slot || rec.reminded) continue;
      if (slot.start <= now) {
        rec.reminded = true;
        await this.d.store.put('party', rec.plan.id, rec);
        continue;
      }
      if (slot.start - now > REMIND_BEFORE) continue;
      rec.reminded = true;
      await this.d.store.put('party', rec.plan.id, rec);
      for (const who of rec.plan.guests.filter((g) => rec.plan.rsvp[g] === 'yes' && !(rec.plan.surprise && g === rec.plan.honoree))) {
        const jobs = (rec.plan.tasks?.specs ?? []).filter((s) => rec.plan.tasks!.owner[s.id] === who && rec.plan.tasks!.state[s.id] === 'accepted').map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1));
        await this.send(who, say.reminder(rec.title, slot, await this.tzOf(who), jobs), [{ id: `party:${rec.plan.id}:withdraw`, label: "Can't come anymore", style: 'danger' }]);
        sent++;
      }
    }
    for (const rec of await this.d.store.list<PairRecord>('pair')) {
      const { plan } = rec;
      if (plan.status !== 'confirmed' || rec.reminded) continue;
      if (plan.interval.start <= now) {
        rec.reminded = true;
        await this.d.store.put('pair', plan.id, rec);
        continue;
      }
      if (plan.interval.start - now > REMIND_BEFORE) continue;
      rec.reminded = true;
      await this.d.store.put('pair', plan.id, rec);
      for (const [who, other] of [[plan.a, plan.b], [plan.b, plan.a]] as const) {
        await this.send(who, say.pairReminder(await this.nameOf(other), plan.interval, await this.tzOf(who)), [{ id: `pair:${plan.id}:cancel`, label: "Can't make it anymore", style: 'danger' }]);
        sent++;
      }
    }
    return sent;
  }

  private async pairRound(now: Ms): Promise<number> {
    const day = localParts(now, DEFAULT_PREFS.tz).dateKey;
    if ((await this.d.store.get<string>('meta', 'lastPairRound')) === day) return 0;
    const circles = await this.d.store.list<CircleRecord>('circle');
    const members = new Set(circles.flatMap((c) => c.members));
    const window = { start: now, end: now + 7 * DAY };
    const people: { id: PersonId; prefs: Prefs; free: Interval[] }[] = [];
    for (const id of members) {
      const rec = await this.person(id);
      if (!rec || rec.paused || !(await this.d.calendar.connected(id))) continue;
      try {
        people.push({ id, prefs: rec.prefs, free: freeFrom(await this.d.calendar.busy(id, window), window) });
      } catch {
        continue;
      }
    }
    const governor = await this.governor();
    // If nobody can be disturbed right now (everyone's quiet hours), do not use up today's round.
    if (people.filter((p) => governor.canDisturb(p.prefs, now).ok).length < 2) return 0;
    const shared = (a: PersonId, b: PersonId) => circles.some((c) => c.members.includes(a) && c.members.includes(b));
    const proposals = proposePairs({ people, lastMet: await this.lastMet(), now, window, governor, areFriends: shared });
    await this.d.store.put('meta', 'lastPairRound', day);
    for (const prop of proposals) {
      const id = `pair-${await this.counter('pair')}`;
      await this.d.store.put<PairRecord>('pair', id, { plan: newPair({ id, a: prop.a, b: prop.b, interval: prop.interval }) });
      await this.dispatchPair(id, 'start', `${id}:start`);
    }
    return proposals.length;
  }
}

function formatDay(ms: Ms, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(ms);
}
