import { describe, expect, it } from 'vitest';
import { MessageSchema } from '../../src/engine/protocol';
import { DAY } from '../../src/engine/time';
import { checkInvariants, gini } from '../../src/sim/metrics';
import { runSim, type SimResult } from '../../src/sim/runner';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const runs: Record<number, SimResult> = {};
const get = (seed: number) => (runs[seed] ??= runSim({ seed, students: 24, weeks: 6 }));

describe('simulation determinism', () => {
  it('gives identical output for the same seed and different output for another', () => {
    const a = runSim({ seed: 7, students: 14, weeks: 4 });
    const b = runSim({ seed: 7, students: 14, weeks: 4 });
    expect(a).toEqual(b);
    expect(runSim({ seed: 8, students: 14, weeks: 4 }).messages).not.toEqual(a.messages);
  });
  it('labels itself as a simulation', () => {
    expect(get(1).label).toBe('simulation');
  });
});

describe('invariants hold on every seed', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: no cap violations, leaks or double bookings`, () => {
      const r = get(seed);
      expect(checkInvariants(r.metrics)).toEqual([]);
    });
  }
});

describe('what the simulation shows', () => {
  const all = () => SEEDS.map(get);

  it('commits parties, reassigns jobs after declines, and uses the cap, folding and pair meetups', () => {
    const rs = all();
    expect(rs.some((r) => r.metrics.partiesCommitted > 0)).toBe(true);
    expect(rs.some((r) => r.metrics.tasksReassigned > 0)).toBe(true);
    expect(rs.some((r) => r.metrics.partiesBlockedByCap > 0)).toBe(true);
    expect(rs.some((r) => r.metrics.occasionsFolded > 0)).toBe(true);
    expect(rs.some((r) => r.metrics.pairMeetups > 0)).toBe(true);
    expect(rs.some((r) => r.metrics.partiesNeedingHost > 0)).toBe(true);
  });

  it('never has two live parties in one circle within 14 days', () => {
    for (const r of all()) {
      const live = r.parties.filter((p) => p.startedAt !== undefined && !['cancelled', 'no_slot'].includes(p.status));
      for (const circle of Object.keys(r.circles)) {
        const times = live.filter((p) => p.circle === circle).map((p) => p.startedAt!).sort((a, b) => a - b);
        for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(14 * DAY);
      }
    }
  });

  it('commits only well-prepared plans', () => {
    for (const r of all()) for (const m of r.messages.filter((x) => x.kind === 'COMMIT')) expect(Number(m.body.readiness)).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps every surprise secret: the honoree only ever gets a silent availability request', () => {
    let surprises = 0;
    for (const r of all()) {
      for (const p of r.parties.filter((x) => x.surprise)) {
        surprises++;
        const toHonoree = r.messages.filter((m) => m.planId.startsWith(p.id.split('#')[0]!) && m.to === p.honoree);
        for (const m of toHonoree) {
          expect(m.kind).toBe('ASK_AVAILABILITY');
          expect(m.body.silent).toBe(true);
        }
        expect(Object.values(p.owners)).not.toContain(p.honoree);
      }
    }
    expect(surprises).toBeGreaterThan(0);
  });

  it('produces valid, uniquely identified messages in time order', () => {
    const r = get(2);
    const ids = new Set(r.messages.map((m) => m.id));
    expect(ids.size).toBe(r.messages.length);
    for (const m of r.messages) expect(MessageSchema.safeParse(m).success).toBe(true);
    for (let i = 1; i < r.messages.length; i++) expect(r.messages[i]!.at).toBeGreaterThanOrEqual(r.messages[i - 1]!.at);
  });

  it('never exposes private labels in the data the UI will load', () => {
    const r = get(3);
    const text = JSON.stringify({ ...r, busy: undefined });
    for (const label of ['therapy', 'dentist', 'job interview', 'doctor', 'family dinner', 'vegetarian', 'gluten-free', 'nut allergy']) {
      expect(text.toLowerCase()).not.toContain(label);
    }
    for (const intervals of Object.values(r.busy)) for (const i of intervals) expect(Object.keys(i).sort()).toEqual(['end', 'start']);
  });

  it('spreads work reasonably (task load Gini below 0.75)', () => {
    for (const r of all()) expect(r.metrics.taskLoadGini).toBeLessThan(0.75);
  });
});

describe('gini', () => {
  it('is 0 for equal loads and high for one person doing everything', () => {
    expect(gini([2, 2, 2, 2])).toBe(0);
    expect(gini([0, 0, 0, 9])).toBeGreaterThan(0.7);
    expect(gini([])).toBe(0);
  });
});
