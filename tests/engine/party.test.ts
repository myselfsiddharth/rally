import { describe, expect, it } from 'vitest';
import { Governor } from '../../src/engine/governor';
import { newParty, reduceParty, type PartyEvent, type PartyPlan } from '../../src/engine/party';
import type { Message } from '../../src/engine/protocol';
import type { Ledger } from '../../src/engine/tasks';
import { DAY, HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS, type Interval, type Prefs } from '../../src/engine/types';

const phx = (m: number, d: number, h: number) => Date.UTC(2026, m - 1, d, h + 7);
const iv = (start: number, end: number): Interval => ({ start, end });
const T = phx(10, 26, 9);
const window = iv(T, T + 7 * DAY);
const friday = iv(phx(10, 30, 17), phx(10, 30, 23));

const prefs: Record<string, Prefs> = {
  ben: { ...DEFAULT_PREFS, hasCar: true, canHost: true },
  ana: { ...DEFAULT_PREFS },
  cy: { ...DEFAULT_PREFS, hasCar: true },
  dee: { ...DEFAULT_PREFS, canHost: true },
  eli: { ...DEFAULT_PREFS, hasCar: true },
  hon: { ...DEFAULT_PREFS, hasCar: true, canHost: true },
};
const everyone = Object.keys(prefs);

function harness(overrides: Partial<Parameters<typeof newParty>[0]> = {}, free: Record<string, Interval[]> = {}) {
  const governor = new Governor();
  let ledger: Ledger = { load: {} };
  let plan: PartyPlan = newParty({ id: 'p1', circle: 'c1', occasion: 'birthday', host: 'ben', honoree: 'hon', guests: everyone, ...overrides });
  const log: Message[] = [];
  let n = 0;
  const send = (type: PartyEvent['type'], extra: Partial<PartyEvent> = {}, at = T + (n + 1) * 1000) => {
    const ev: PartyEvent = { id: `e${n++}`, at, type, ...extra };
    const step = reduceParty(plan, ev, { people: prefs, ledger, governor, window, durationMs: 3 * HOUR });
    plan = step.plan;
    ledger = step.ledger;
    log.push(...step.out);
    return step;
  };
  const collect = () => {
    send('start', { person: 'ben' });
    for (const g of plan.guests) send('availability', { person: g, free: free[g] ?? [friday] });
  };
  const rsvpAll = () => {
    for (const g of plan.slot!.attendees) if (g !== 'ben' && !plan.rsvp[g]) send('rsvp_yes', { person: g });
  };
  const acceptAll = () => {
    for (const s of plan.tasks!.specs) {
      const o = plan.tasks!.owner[s.id];
      if (o && plan.tasks!.state[s.id] !== 'accepted') send('task_accept', { person: o, taskId: s.id });
    }
  };
  return { governor, get ledger() { return ledger; }, get plan() { return plan; }, log, send, collect, rsvpAll, acceptAll, free };
}

describe('party happy path', () => {
  it('collects availability, proposes a Friday evening, assigns jobs and commits', () => {
    const h = harness();
    h.collect();
    expect(h.plan.status).toBe('proposed');
    expect(h.plan.slot!.interval.start).toBe(phx(10, 30, 17));
    expect(h.log.filter((m) => m.kind === 'ASK_AVAILABILITY')).toHaveLength(6);
    h.rsvpAll();
    expect(h.plan.status).toBe('assigning');
    expect(h.log.filter((m) => m.kind === 'TASK_OFFER').length).toBeGreaterThan(3);
    h.acceptAll();
    expect(h.plan.status).toBe('committed');
    expect(h.log.filter((m) => m.kind === 'COMMIT').length).toBe(6);
    expect(Object.values(h.ledger.load).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(h.governor.canStartParty('c1', T + DAY)).toEqual({ ok: false, reason: 'party_cap' });
  });
});

describe('declines and escalation', () => {
  it('moves a declined job to the backup and offers it to them', () => {
    const h = harness();
    h.collect();
    h.rsvpAll();
    const owner = h.plan.tasks!.owner.cake!;
    const backup = h.plan.tasks!.backup.cake!;
    h.send('task_decline', { person: owner, taskId: 'cake' });
    expect(h.plan.tasks!.owner.cake).toBe(backup);
    expect(h.plan.reassigned).toBe(1);
    const offer = h.log.filter((m) => m.kind === 'TASK_OFFER' && m.to === backup && m.body.reassigned);
    expect(offer).toHaveLength(1);
    h.acceptAll();
    expect(h.plan.status).toBe('committed');
  });

  it('escalates to the host when nobody can take a job, once, and continues when the host waives it', () => {
    const h = harness();
    h.collect();
    h.rsvpAll();
    // everybody declines the venue in turn
    for (let i = 0; i < 8 && h.plan.tasks!.owner.venue; i++) h.send('task_decline', { person: h.plan.tasks!.owner.venue!, taskId: 'venue' });
    expect(h.plan.status).toBe('needs_host');
    expect(h.log.filter((m) => m.kind === 'NEEDS_HOST' && m.body.taskId === 'venue')).toHaveLength(1);
    h.send('host_waive', { person: 'ben', taskId: 'venue' });
    h.acceptAll();
    expect(h.plan.status).toBe('committed');
  });

  it('lets the host assign a job directly', () => {
    const h = harness();
    h.collect();
    h.rsvpAll();
    for (let i = 0; i < 8 && h.plan.tasks!.owner.venue; i++) h.send('task_decline', { person: h.plan.tasks!.owner.venue!, taskId: 'venue' });
    h.send('host_assign', { person: 'ben', taskId: 'venue', target: 'dee' });
    expect(h.plan.tasks!.owner.venue).toBe('dee');
    expect(h.log.some((m) => m.kind === 'TASK_OFFER' && m.to === 'dee' && m.body.byHost)).toBe(true);
  });
});

describe('robustness', () => {
  it('ignores a duplicate event id', () => {
    const h = harness();
    h.send('start', { person: 'ben' });
    const before = JSON.stringify(h.plan);
    const count = h.log.length;
    const step = reduceParty(h.plan, { id: h.plan.seen[0]!, at: T, type: 'start' }, { people: prefs, ledger: h.ledger, governor: h.governor, window, durationMs: 3 * HOUR });
    expect(JSON.stringify(step.plan)).toBe(before);
    expect(step.out).toEqual([]);
    expect(h.log.length).toBe(count);
  });

  it('ignores a late accept after cancel and never throws on events in the wrong state', () => {
    const h = harness();
    h.collect();
    h.rsvpAll();
    const owner = h.plan.tasks!.owner.cake!;
    h.send('cancel', { person: 'ben' });
    expect(h.plan.status).toBe('cancelled');
    const snapshot = JSON.stringify(h.plan);
    expect(() => h.send('task_accept', { person: owner, taskId: 'cake' })).not.toThrow();
    h.send('rsvp_yes', { person: 'ana' });
    h.send('availability', { person: 'ana', free: [] });
    expect(JSON.stringify({ ...h.plan, seen: [] })).toBe(JSON.stringify({ ...JSON.parse(snapshot), seen: [] }));
    expect(h.governor.canStartParty('c1', T + DAY)).toEqual({ ok: true });
  });

  it('only the host can cancel', () => {
    const h = harness();
    h.collect();
    h.send('cancel', { person: 'ana' });
    expect(h.plan.status).toBe('proposed');
  });
});

describe('no slot, caps and small groups', () => {
  it('reports no_slot to the host only and gives the party cap back', () => {
    const free = Object.fromEntries(everyone.map((id, i) => [id, [iv(phx(10, 27 + (i % 3), 10), phx(10, 27 + (i % 3), 12))]]));
    const h = harness({}, free);
    h.collect();
    expect(h.plan.status).toBe('no_slot');
    const cancels = h.log.filter((m) => m.kind === 'CANCEL');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.to).toBe('ben');
    expect(h.governor.canStartParty('c1', T + DAY)).toEqual({ ok: true });
  });

  it('refuses a second party in the same circle within 14 days and tells only the host', () => {
    const h = harness();
    h.governor.recordParty('c1', T - 3 * DAY);
    h.send('start', { person: 'ben' });
    expect(h.plan.status).toBe('cancelled');
    expect(h.plan.reason).toBe('party_cap');
    expect(h.log.filter((m) => m.kind === 'CANCEL')).toEqual([expect.objectContaining({ to: 'ben', body: { reason: 'party_cap' } })]);
  });

  it('turns a tiny circle away instead of planning', () => {
    const h = harness({ guests: ['ana'], honoree: null });
    h.send('start', { person: 'ben' });
    expect(h.plan.status).toBe('no_slot');
    expect(h.plan.reason).toBe('too_small');
  });

  it('cancels when too few say yes', () => {
    const h = harness();
    h.collect();
    for (const g of h.plan.slot!.attendees) if (g !== 'ben') h.send('rsvp_no', { person: g });
    expect(h.plan.status).toBe('cancelled');
    expect(h.plan.reason).toBe('too_few');
  });

  it('ignores a late rsvp_no from the host, who said yes by starting the plan', () => {
    const h = harness();
    h.collect();
    // host is auto-yes, so a late rsvp_no from the host is ignored
    h.send('rsvp_no', { person: 'ben' });
    expect(h.plan.status).toBe('proposed');
  });

  it('proceeds on timeout with partial availability and with partial RSVPs', () => {
    const h = harness();
    h.send('start', { person: 'ben' });
    for (const g of ['ben', 'ana', 'cy', 'dee']) h.send('availability', { person: g, free: [friday] });
    expect(h.plan.status).toBe('collecting');
    h.send('timeout');
    expect(h.plan.status).toBe('proposed');
    expect(h.plan.slot!.leftOut.map((l) => l.id).sort()).toEqual(['eli', 'hon']);
    h.send('rsvp_yes', { person: 'ana' });
    h.send('timeout');
    expect(['assigning', 'needs_host']).toContain(h.plan.status);
  });
});

describe('surprise party', () => {
  it('tells the honoree nothing visible and gives them no job', () => {
    const h = harness({ surprise: true });
    h.collect();
    h.rsvpAll();
    h.acceptAll();
    expect(h.plan.status).toBe('committed');
    const toHon = h.log.filter((m) => m.to === 'hon');
    expect(toHon.every((m) => m.kind === 'ASK_AVAILABILITY' && m.body.silent === true)).toBe(true);
    expect(Object.values(h.plan.tasks!.owner)).not.toContain('hon');
    expect(Object.values(h.plan.tasks!.backup)).not.toContain('hon');
  });

  it('is not a surprise for a normal birthday: the honoree is invited but still has no job', () => {
    const h = harness();
    h.collect();
    h.rsvpAll();
    expect(h.log.some((m) => m.to === 'hon' && m.kind === 'PROPOSE')).toBe(true);
    expect(Object.values(h.plan.tasks!.owner)).not.toContain('hon');
  });
});
