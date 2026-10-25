import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Governor, pairKey } from '../../src/engine/governor';
import { DAY, HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS, type Prefs } from '../../src/engine/types';

// 2026-10-26 19:00 Phoenix (Monday evening) = 2026-10-27 02:00 UTC
const T0 = Date.UTC(2026, 9, 27, 2);
const p = (over: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...over });
const A = { id: 'ana', prefs: p() };
const B = { id: 'ben', prefs: p() };

describe('party cap', () => {
  it('blocks a second party within 14 days and allows it on day 14', () => {
    const g = new Governor();
    expect(g.canStartParty('c1', T0)).toEqual({ ok: true });
    g.recordParty('c1', T0);
    expect(g.canStartParty('c1', T0 + 13 * DAY)).toEqual({ ok: false, reason: 'party_cap' });
    expect(g.canStartParty('c1', T0 + 14 * DAY)).toEqual({ ok: true });
  });
  it('does not affect other circles', () => {
    const g = new Governor();
    g.recordParty('c1', T0);
    expect(g.canStartParty('c2', T0 + DAY)).toEqual({ ok: true });
  });
  it('frees the cap when a plan is cancelled', () => {
    const g = new Governor();
    g.recordParty('c1', T0);
    g.releaseParty('c1', T0);
    expect(g.canStartParty('c1', T0 + DAY)).toEqual({ ok: true });
  });
});

describe('pair invites', () => {
  it('allows 1 per day then blocks with day_cap', () => {
    const g = new Governor();
    expect(g.canInvitePair(A, B, T0)).toEqual({ ok: true });
    g.recordPairInvite('ana', T0);
    expect(g.canInvitePair(A, B, T0 + HOUR)).toEqual({ ok: false, reason: 'day_cap' });
    expect(g.canInvitePair(B, A, T0 + HOUR)).toEqual({ ok: false, reason: 'day_cap' });
  });
  it('allows 2 per rolling week then blocks with week_cap', () => {
    const g = new Governor();
    g.recordPairInvite('ana', T0);
    g.recordPairInvite('ana', T0 + 2 * DAY);
    expect(g.canInvitePair(A, B, T0 + 4 * DAY)).toEqual({ ok: false, reason: 'week_cap' });
    expect(g.canInvitePair(A, B, T0 + 8 * DAY)).toEqual({ ok: true });
  });
  it('blocks a declined pair for 7 days in both directions but not other pairs', () => {
    const g = new Governor();
    g.recordDecline('ana', 'ben', T0);
    expect(g.canInvitePair(A, B, T0 + 6 * DAY)).toEqual({ ok: false, reason: 'cooldown' });
    expect(g.canInvitePair(B, A, T0 + 6 * DAY)).toEqual({ ok: false, reason: 'cooldown' });
    expect(g.canInvitePair(A, B, T0 + 7 * DAY)).toEqual({ ok: true });
    expect(g.canInvitePair(A, { id: 'cy', prefs: p() }, T0 + DAY)).toEqual({ ok: true });
  });
  it('respects never-suggest in both directions', () => {
    const g = new Governor();
    const a = { id: 'ana', prefs: p({ neverSuggest: ['ben'] }) };
    expect(g.canInvitePair(a, B, T0)).toEqual({ ok: false, reason: 'never_suggest' });
    expect(g.canInvitePair(B, a, T0)).toEqual({ ok: false, reason: 'never_suggest' });
  });
  it('respects quiet hours for either person', () => {
    const g = new Governor();
    const late = Date.UTC(2026, 9, 27, 6); // 23:00 Phoenix
    expect(g.canInvitePair(A, B, late)).toEqual({ ok: false, reason: 'quiet_hours' });
    expect(g.canDisturb(DEFAULT_PREFS, late)).toEqual({ ok: false, reason: 'quiet_hours' });
    expect(g.canDisturb(DEFAULT_PREFS, T0)).toEqual({ ok: true });
  });
  it('uses each person\'s own caps', () => {
    const g = new Governor();
    const strict = { id: 'ana', prefs: p({ maxPairInvitesPerWeek: 1 }) };
    g.recordPairInvite('ana', T0);
    expect(g.canInvitePair(strict, B, T0 + 2 * DAY)).toEqual({ ok: false, reason: 'week_cap' });
  });
});

describe('serialisation', () => {
  it('round-trips behaviour', () => {
    const g = new Governor();
    g.recordParty('c1', T0);
    g.recordPairInvite('ana', T0);
    g.recordDecline('ana', 'ben', T0);
    const copy = Governor.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(copy.canStartParty('c1', T0 + DAY)).toEqual({ ok: false, reason: 'party_cap' });
    expect(copy.canInvitePair(A, B, T0 + HOUR)).toEqual({ ok: false, reason: 'cooldown' });
  });
  it('pairKey is order independent', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
  });
});

describe('property: obeying ok never exceeds a limit', () => {
  it('daily and weekly invite counts stay within caps', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 20 * 24 }), { maxLength: 60 }), (hours) => {
        const g = new Governor();
        const sent: number[] = [];
        for (const h of [...hours].sort((x, y) => x - y)) {
          const at = T0 + h * HOUR;
          if (g.canInvitePair(A, B, at).ok) {
            g.recordPairInvite('ana', at);
            sent.push(at);
          }
        }
        for (const at of sent) {
          expect(sent.filter((x) => x <= at && at - x < DAY).length).toBeLessThanOrEqual(1);
          expect(sent.filter((x) => x <= at && at - x < 7 * DAY).length).toBeLessThanOrEqual(2);
        }
      }),
    );
  });
});

describe('nextPartyAllowedAt', () => {
  it('says when the cap clears', () => {
    const g = new Governor();
    expect(g.nextPartyAllowedAt('c1', T0)).toBe(T0);
    g.recordParty('c1', T0);
    expect(g.nextPartyAllowedAt('c1', T0 + 3 * DAY)).toBe(T0 + 14 * DAY);
    expect(g.nextPartyAllowedAt('c1', T0 + 14 * DAY)).toBe(T0 + 14 * DAY);
  });
});
