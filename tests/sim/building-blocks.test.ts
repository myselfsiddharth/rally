import { describe, expect, it } from 'vitest';
import { merge } from '../../src/engine/time';
import { makeCalendar, phoenixMidnight } from '../../src/sim/calendars';
import { makePersonas } from '../../src/sim/personas';
import { createRng } from '../../src/sim/rng';
import { SIM_START, makeWorld } from '../../src/sim/world';
import { DAY } from '../../src/engine/time';

describe('rng', () => {
  it('is deterministic and covers its ranges', () => {
    const a = createRng(5);
    const b = createRng(5);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
    const r = createRng(9);
    for (let i = 0; i < 200; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
  it('shuffle keeps the elements', () => {
    expect(createRng(3).shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('personas', () => {
  it('makes the requested number, in circles, deterministically', () => {
    const a = makePersonas(1, 30, 56);
    const b = makePersonas(1, 30, 56);
    expect(a).toEqual(b);
    expect(a.personas).toHaveLength(30);
    expect(new Set(a.personas.map((p) => p.id)).size).toBe(30);
    expect(Object.keys(a.circles).length).toBeGreaterThanOrEqual(4);
    for (const members of Object.values(a.circles)) expect(members.length).toBeGreaterThanOrEqual(4);
    expect(makePersonas(2, 30, 56)).not.toEqual(a);
  });
  it('handles more students than names', () => {
    const c = makePersonas(1, 50, 56);
    expect(new Set(c.personas.map((p) => p.name)).size).toBe(50);
  });
});

describe('calendars', () => {
  it('stays inside the window and has private labels', () => {
    const cohort = makePersonas(1, 5, 56);
    const window = { start: SIM_START, end: SIM_START + 21 * DAY };
    const cal = makeCalendar(createRng(4), cohort.personas[0]!, window);
    expect(cal.events.length).toBeGreaterThan(10);
    for (const e of cal.events) {
      expect(e.interval.end).toBeGreaterThan(e.interval.start);
      expect(e.interval.end).toBeGreaterThan(window.start);
      expect(e.interval.start).toBeLessThan(window.end);
      expect(e.label.length).toBeGreaterThan(0);
    }
    expect(merge(cal.events.map((e) => e.interval)).length).toBeGreaterThan(5);
  });
  it('phoenixMidnight is 07:00 UTC', () => {
    expect(phoenixMidnight(Date.UTC(2026, 9, 20, 15))).toBe(Date.UTC(2026, 9, 20, 7));
    expect(phoenixMidnight(Date.UTC(2026, 9, 20, 3))).toBe(Date.UTC(2026, 9, 19, 7));
  });
});

describe('world', () => {
  it('has birthdays, Halloween per circle and concerts, in time order', () => {
    const cohort = makePersonas(3, 30, 56);
    const world = makeWorld(3, cohort, 8);
    expect(world.filter((o) => o.occasion === 'birthday').length).toBeGreaterThan(8);
    expect(world.filter((o) => o.occasion === 'halloween')).toHaveLength(Object.keys(cohort.circles).length);
    expect(world.filter((o) => o.occasion === 'concert')).toHaveLength(3);
    for (let i = 1; i < world.length; i++) expect(world[i]!.at).toBeGreaterThanOrEqual(world[i - 1]!.at);
    for (const o of world) {
      expect(o.at).toBeGreaterThan(SIM_START);
      expect(o.window.end).toBeGreaterThan(o.window.start);
      expect(o.window.end - o.window.start).toBeGreaterThanOrEqual(o.durationMs);
    }
  });
});
