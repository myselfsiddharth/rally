import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Governor } from '../../src/engine/governor';
import { proposePairs, sortedPairKey } from '../../src/engine/pairs';
import { DAY, HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS, type Interval, type Prefs } from '../../src/engine/types';

const phx = (m: number, d: number, h: number) => Date.UTC(2026, m - 1, d, h + 7);
const iv = (start: number, end: number): Interval => ({ start, end });
const now = phx(10, 26, 9); // Monday 09:00
const window = iv(now, now + 7 * DAY);
const allFree = [window];
const who = (id: string, over: Partial<Prefs> = {}, free: Interval[] = allFree) => ({ id, prefs: { ...DEFAULT_PREFS, ...over }, free });

describe('proposePairs', () => {
  it('pairs two friends with a shared free evening hour, inside the evening', () => {
    const out = proposePairs({ people: [who('ana'), who('ben')], lastMet: {}, now, window, governor: new Governor() });
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(new Set([p.a, p.b])).toEqual(new Set(['ana', 'ben']));
    expect(p.interval.end - p.interval.start).toBe(HOUR);
    expect(p.interval.start).toBeGreaterThanOrEqual(phx(10, 26, 17));
    expect(p.interval.end).toBeLessThanOrEqual(phx(10, 26, 22));
  });

  it('proposes nothing without a shared hour', () => {
    const a = who('ana', {}, [iv(phx(10, 27, 18), phx(10, 27, 19))]);
    const b = who('ben', {}, [iv(phx(10, 28, 18), phx(10, 28, 19))]);
    expect(proposePairs({ people: [a, b], lastMet: {}, now, window, governor: new Governor() })).toEqual([]);
  });

  it('needs at least 60 minutes together', () => {
    const half = [iv(phx(10, 27, 18), phx(10, 27, 18) + 30 * 60_000)];
    expect(proposePairs({ people: [who('ana', {}, half), who('ben', {}, half)], lastMet: {}, now, window, governor: new Governor() })).toEqual([]);
  });

  it('skips people at their weekly cap and pairs in cooldown', () => {
    const g = new Governor();
    g.recordPairInvite('ana', now - 2 * DAY);
    g.recordPairInvite('ana', now - 3 * DAY);
    expect(proposePairs({ people: [who('ana'), who('ben')], lastMet: {}, now, window, governor: g })).toEqual([]);
    const g2 = new Governor();
    g2.recordDecline('ana', 'ben', now - DAY);
    expect(proposePairs({ people: [who('ana'), who('ben')], lastMet: {}, now, window, governor: g2 })).toEqual([]);
  });

  it('respects never-suggest', () => {
    const out = proposePairs({ people: [who('ana', { neverSuggest: ['ben'] }), who('ben')], lastMet: {}, now, window, governor: new Governor() });
    expect(out).toEqual([]);
  });

  it('prefers the pair who have not met for longer, and uses each person once', () => {
    const lastMet = { [sortedPairKey('ana', 'ben')]: now - 2 * DAY, [sortedPairKey('ana', 'cy')]: now - 40 * DAY, [sortedPairKey('ben', 'cy')]: now - 2 * DAY };
    const out = proposePairs({ people: [who('ana'), who('ben'), who('cy')], lastMet, now, window, governor: new Governor() });
    expect(out).toHaveLength(1);
    expect(new Set([out[0]!.a, out[0]!.b])).toEqual(new Set(['ana', 'cy']));
  });

  it('asks the person with fewer recent invites first', () => {
    const g = new Governor();
    g.recordPairInvite('ben', now - 3 * DAY);
    const out = proposePairs({ people: [who('ana'), who('ben')], lastMet: {}, now, window, governor: g });
    expect(out[0]!.a).toBe('ana');
  });

  it('shared interests raise the score', () => {
    const people = [who('ana', { interests: ['climbing'] }), who('ben'), who('cy', { interests: ['climbing'] })];
    const out = proposePairs({ people, lastMet: {}, now, window, governor: new Governor() });
    expect(new Set([out[0]!.a, out[0]!.b])).toEqual(new Set(['ana', 'cy']));
  });

  it('property: never violates the governor and never repeats a person', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 0, max: 5 }), (n, recent) => {
        const g = new Governor();
        const people = Array.from({ length: n }, (_, i) => who(`p${i}`));
        for (let i = 0; i < Math.min(recent, n); i++) {
          g.recordPairInvite(`p${i}`, now - DAY / 2);
        }
        const out = proposePairs({ people, lastMet: {}, now, window, governor: g });
        const seen = new Set<string>();
        for (const p of out) {
          expect(seen.has(p.a) || seen.has(p.b)).toBe(false);
          seen.add(p.a);
          seen.add(p.b);
          expect(g.canInvitePair({ id: p.a, prefs: DEFAULT_PREFS }, { id: p.b, prefs: DEFAULT_PREFS }, now)).toEqual({ ok: true });
        }
      }),
    );
  });
});
