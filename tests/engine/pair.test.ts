import { describe, expect, it } from 'vitest';
import { Governor } from '../../src/engine/governor';
import { newPair, reducePair, type PairEvent, type PairPlan } from '../../src/engine/pair';
import type { Message } from '../../src/engine/protocol';
import { DAY, HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS } from '../../src/engine/types';

const T = Date.UTC(2026, 9, 27, 2);
const interval = { start: T + DAY, end: T + DAY + HOUR };

function run(events: PairEvent['type'][]) {
  const governor = new Governor();
  let plan: PairPlan = newPair({ id: 'x1', a: 'ana', b: 'ben', interval });
  const log: Message[] = [];
  events.forEach((type, i) => {
    const step = reducePair(plan, { id: `e${i}`, at: T + i * 1000, type }, { governor });
    plan = step.plan;
    log.push(...step.out);
  });
  return { plan, log, governor };
}

describe('pair double opt-in', () => {
  it('does not message B before A says yes', () => {
    const { log } = run(['start']);
    expect(log.map((m) => [m.to, m.kind])).toEqual([['ana', 'PAIR_ASK']]);
  });

  it('A saying no never reaches B and starts a cooldown', () => {
    const { plan, log, governor } = run(['start', 'a_no']);
    expect(plan.status).toBe('dropped');
    expect(log.filter((m) => m.to === 'ben')).toEqual([]);
    expect(governor.canInvitePair({ id: 'ana', prefs: DEFAULT_PREFS }, { id: 'ben', prefs: DEFAULT_PREFS }, T + DAY)).toEqual({ ok: false, reason: 'cooldown' });
  });

  it('B saying no tells A only "not this time", with no name or reason', () => {
    const { plan, log } = run(['start', 'a_yes', 'b_no']);
    expect(plan.status).toBe('dropped');
    const toAna = log.filter((m) => m.to === 'ana' && m.kind === 'PAIR_NO');
    expect(toAna).toEqual([expect.objectContaining({ body: { text: 'Not this time.' } })]);
  });

  it('both yes confirms and tells each of them', () => {
    const { plan, log } = run(['start', 'a_yes', 'b_yes']);
    expect(plan.status).toBe('confirmed');
    expect(log.filter((m) => m.kind === 'PAIR_YES').map((m) => m.to).sort()).toEqual(['ana', 'ben']);
  });

  it('ignores answers in the wrong order and duplicates', () => {
    expect(run(['start', 'b_yes']).plan.status).toBe('asking_a');
    const governor = new Governor();
    let plan = newPair({ id: 'x2', a: 'ana', b: 'ben', interval });
    plan = reducePair(plan, { id: 's', at: T, type: 'start' }, { governor }).plan;
    const again = reducePair(plan, { id: 's', at: T, type: 'start' }, { governor });
    expect(again.out).toEqual([]);
    expect(again.plan).toBe(plan);
  });

  it('drops quietly on timeout', () => {
    const { plan, log } = run(['start', 'timeout']);
    expect(plan.status).toBe('dropped');
    expect(log).toHaveLength(1);
  });

  it('counts the invite against each person only when they are asked', () => {
    const { governor } = run(['start']);
    expect(governor.recentInviteCount('ana', T + 1)).toBe(1);
    expect(governor.recentInviteCount('ben', T + 1)).toBe(0);
  });
});
