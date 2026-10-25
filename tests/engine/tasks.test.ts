import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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
  type PlanTasks,
} from '../../src/engine/tasks';
import { DEFAULT_PREFS, type Prefs } from '../../src/engine/types';

const person = (id: string, over: Partial<Prefs> = {}) => ({ id, prefs: { ...DEFAULT_PREFS, ...over } });
const noLoad: Ledger = { load: {} };
const owned = (plan: PlanTasks, id: string) => Object.values(plan.owner).filter((o) => o === id).length;

const friends = [person('ana'), person('ben', { hasCar: true, canHost: true }), person('cy', { hasCar: true }), person('dee')];

describe('templates', () => {
  it('birthday has a critical venue and a car-needing ride', () => {
    const t = templateFor('birthday');
    expect(t.find((s) => s.id === 'venue')).toMatchObject({ critical: true, needs: { host: true } });
    expect(t.find((s) => s.id === 'ride')?.needs.car).toBe(true);
  });
});

describe('assign', () => {
  it('never gives the guest of honor a job', () => {
    const plan = assign(templateFor('birthday'), [...friends, person('hon', { hasCar: true, canHost: true })], noLoad, ['hon']);
    expect(Object.values(plan.owner)).not.toContain('hon');
    expect(Object.values(plan.backup)).not.toContain('hon');
  });

  it('gives car and host jobs only to people who qualify', () => {
    const plan = assign(templateFor('birthday'), friends, noLoad, []);
    expect(plan.owner.ride).not.toBeNull();
    expect(['ben', 'cy']).toContain(plan.owner.ride);
    expect(plan.owner.venue).toBe('ben');
  });

  it('marks a job nobody can do as declined_all and lists it for the host', () => {
    const noCars = [person('ana'), person('dee', { canHost: true })];
    const plan = assign(templateFor('birthday'), noCars, noLoad, []);
    expect(plan.owner.ride).toBeNull();
    expect(plan.state.ride).toBe('declined_all');
    expect(needsHost(plan)).toContain('ride');
  });

  it('spreads work: someone with a heavy recent load gets fewer jobs', () => {
    const plan = assign(templateFor('birthday'), friends, { load: { ana: 5 } }, ['hon']);
    expect(owned(plan, 'ana')).toBeLessThan(Math.max(owned(plan, 'ben'), owned(plan, 'cy'), owned(plan, 'dee')));
  });

  it('is deterministic', () => {
    expect(assign(templateFor('birthday'), friends, noLoad, [])).toEqual(assign(templateFor('birthday'), friends, noLoad, []));
  });

  it('gives every job a different backup than its owner when someone else is eligible', () => {
    const plan = assign(templateFor('halloween'), friends, noLoad, []);
    for (const s of plan.specs) {
      if (plan.owner[s.id] && plan.backup[s.id]) expect(plan.backup[s.id]).not.toBe(plan.owner[s.id]);
    }
  });

  it('property: capacity and eligibility always hold', () => {
    const arb = fc.array(fc.record({ car: fc.boolean(), host: fc.boolean(), budget: fc.constantFrom('low', 'mid', 'high' as const), load: fc.integer({ min: 0, max: 8 }) }), { minLength: 0, maxLength: 9 });
    fc.assert(
      fc.property(arb, fc.constantFrom('birthday', 'halloween', 'concert', 'hangout' as const), (raw, occasion) => {
        const people = raw.map((r, i) => person(`p${i}`, { hasCar: r.car, canHost: r.host, budget: r.budget as Prefs['budget'] }));
        const ledger: Ledger = { load: Object.fromEntries(raw.map((r, i) => [`p${i}`, r.load])) };
        const plan = assign(templateFor(occasion), people, ledger, []);
        for (const s of plan.specs) {
          const o = plan.owner[s.id];
          if (!o) continue;
          const prefs = people.find((p) => p.id === o)!.prefs;
          if (s.needs.car) expect(prefs.hasCar).toBe(true);
          if (s.needs.host) expect(prefs.canHost).toBe(true);
        }
        for (const p of people) {
          expect(owned(plan, p.id)).toBeLessThanOrEqual(2);
          const crit = plan.specs.filter((s) => s.critical && plan.owner[s.id] === p.id).length;
          expect(crit).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});

describe('decline', () => {
  const people = [...friends, person('eli', { hasCar: true })];
  it('promotes the backup and picks a new, different backup', () => {
    const plan = assign(templateFor('birthday'), people, noLoad, []);
    const owner = plan.owner.cake!;
    const backup = plan.backup.cake!;
    const next = decline(plan, 'cake', owner, people, noLoad, []);
    expect(next.owner.cake).toBe(backup);
    expect(next.owner.cake).not.toBe(owner);
    expect(next.backup.cake).not.toBe(owner);
    expect(next.backup.cake).not.toBe(backup);
    expect(next.state.cake).toBe('offered');
    expect(next.declinedBy.cake).toEqual([owner]);
  });

  it('ends in declined_all when everyone eligible has declined', () => {
    let plan = assign(templateFor('birthday'), people, noLoad, []);
    for (let i = 0; i < 10 && plan.owner.cake; i++) plan = decline(plan, 'cake', plan.owner.cake, people, noLoad, []);
    expect(plan.owner.cake).toBeNull();
    expect(plan.state.cake).toBe('declined_all');
    expect(needsHost(plan)).toContain('cake');
  });

  it('ignores a decline from someone who is not the owner or backup', () => {
    const plan = assign(templateFor('birthday'), people, noLoad, []);
    const next = decline(plan, 'cake', 'nobody', people, noLoad, []);
    expect(next).toEqual(plan);
  });

  it('replaces only the backup when the backup declines', () => {
    const plan = assign(templateFor('birthday'), people, noLoad, []);
    const owner = plan.owner.cake;
    const next = decline(plan, 'cake', plan.backup.cake!, people, noLoad, []);
    expect(next.owner.cake).toBe(owner);
    expect(next.backup.cake).not.toBe(plan.backup.cake);
  });
});

describe('readiness and commit', () => {
  const people = [...friends, person('eli', { hasCar: true, canHost: true })];
  it('is 0.5 with owners offered and backups present, rising to 1 when all accept', () => {
    let plan = assign(templateFor('hangout'), people, noLoad, []);
    expect(readiness(plan)).toBe(0.5);
    for (const s of plan.specs) plan = accept(plan, s.id, plan.owner[s.id]!);
    expect(readiness(plan)).toBe(1);
  });
  it('is 0 when nobody can do anything', () => {
    expect(readiness(assign(templateFor('birthday'), [], noLoad, []))).toBe(0);
  });
  it('cannot commit unless every critical job is accepted, even at high readiness', () => {
    let plan = assign(templateFor('birthday'), people, noLoad, []);
    for (const s of plan.specs) if (s.id !== 'venue') plan = accept(plan, s.id, plan.owner[s.id]!);
    expect(readiness(plan)).toBeGreaterThan(0.8);
    expect(canCommit(plan)).toBe(false);
    plan = accept(plan, 'venue', plan.owner.venue!);
    expect(canCommit(plan)).toBe(true);
  });
  it('ignores accept from the wrong person', () => {
    const plan = assign(templateFor('hangout'), people, noLoad, []);
    expect(accept(plan, 'venue', 'stranger')).toEqual(plan);
  });
});

describe('groupNotes', () => {
  it('never names a dietary need or a person', () => {
    const notes = groupNotes([person('ana', { dietary: ['vegan'] }), person('ben', { dietary: ['peanut allergy'] })]);
    expect(notes.join(' ')).not.toMatch(/vegan|peanut|ana|ben/i);
    expect(notes.length).toBeGreaterThan(0);
    expect(groupNotes([person('cy')])).toEqual([]);
  });
});
