import { describe, expect, it } from 'vitest';
import { replayState, planMessages, describeMessage } from '../src/ui/replay';
import { runSim } from '../src/sim/runner';
import type { Message } from '../src/engine/protocol';

const m = (i: number, kind: Message['kind'], body: Record<string, unknown> = {}, to = 'x', from = 'coordinator'): Message => ({ id: `p:${i}`, planId: 'p', at: i * 1000, from, to, kind, body });

describe('replayState', () => {
  const log: Message[] = [
    m(0, 'ASK_AVAILABILITY'),
    m(1, 'PROPOSE', { interval: { start: 0, end: 1 } }),
    m(2, 'TASK_OFFER', { taskId: 'cake', weight: 3, totalWeight: 10 }, 'ana'),
    m(3, 'TASK_OFFER', { taskId: 'music', weight: 7, totalWeight: 10 }, 'ben'),
    m(4, 'TASK_ACCEPT', { taskId: 'cake' }, 'coordinator', 'ana'),
    m(5, 'TASK_DECLINE', { taskId: 'music' }, 'coordinator', 'ben'),
    m(6, 'TASK_OFFER', { taskId: 'music', weight: 7, totalWeight: 10, reassigned: true }, 'cy'),
    m(7, 'TASK_ACCEPT', { taskId: 'music' }, 'coordinator', 'cy'),
    m(8, 'COMMIT', { readiness: 0.95 }, 'ana'),
  ];
  it('starts empty', () => {
    expect(replayState(log, 0)).toMatchObject({ readiness: 0, shown: 0, highlights: [] });
  });
  it('readiness grows with accepted work and drops back when a job is declined', () => {
    expect(replayState(log, 5).readiness).toBeCloseTo(0.3);
    expect(replayState(log, 6).readiness).toBeCloseTo(0.3);
    expect(replayState(log, 8).readiness).toBeCloseTo(1);
    expect(replayState(log, 9).readiness).toBe(0.95);
  });
  it('highlights the decline and the re-offer, and no others', () => {
    expect(replayState(log, 9).highlights).toEqual([5, 6]);
    expect(replayState(log, 5).highlights).toEqual([]);
  });
  it('clamps the position', () => {
    expect(replayState(log, 99).shown).toBe(log.length);
    expect(replayState(log, -3).shown).toBe(0);
  });
});

describe('planMessages and describeMessage', () => {
  const r = runSim({ seed: 3, students: 14, weeks: 4 });
  const names = Object.fromEntries(r.students.map((s) => [s.id, s.name]));
  it('keeps only one plan\'s messages, in order', () => {
    const party = r.parties.find((p) => p.status === 'committed')!;
    const msgs = planMessages(r.messages, party.id);
    expect(msgs.length).toBeGreaterThan(5);
    expect(msgs.every((x) => x.planId === party.id)).toBe(true);
  });
  it('turns every message into a short sentence naming people, never ids', () => {
    for (const msg of r.messages.slice(0, 300)) {
      const text = describeMessage(msg, names);
      expect(text.length).toBeGreaterThan(5);
      expect(text).not.toMatch(/\bs\d\d\b/);
    }
  });
});

import { ticketView } from '../src/ui/replay';

describe('ticketView', () => {
  const mk = (i: number, kind: Message['kind'], body: Record<string, unknown>, to = 'x', from = 'coordinator'): Message => ({ id: `p:${i}`, planId: 'p', at: i, from, to, kind, body });
  const log = [
    mk(0, 'PROPOSE', { interval: { start: 1, end: 2 } }, 'ana'),
    mk(1, 'ACCEPT', {}, 'coordinator', 'ana'),
    mk(2, 'TASK_OFFER', { taskId: 'cake', label: 'Bring the cake' }, 'ana'),
    mk(3, 'TASK_DECLINE', { taskId: 'cake' }, 'coordinator', 'ana'),
    mk(4, 'TASK_OFFER', { taskId: 'cake', label: 'Bring the cake', reassigned: true }, 'ben'),
    mk(5, 'TASK_ACCEPT', { taskId: 'cake' }, 'coordinator', 'ben'),
    mk(6, 'COMMIT', { readiness: 1 }, 'ana'),
  ];
  it('tracks who holds a job as it is passed on and re-assigned', () => {
    expect(ticketView(log, 3).jobs).toEqual([{ taskId: 'cake', label: 'Bring the cake', owner: 'ana', state: 'offered', passedBy: [] }]);
    expect(ticketView(log, 4).jobs[0]).toMatchObject({ owner: 'ana', state: 'passed', passedBy: ['ana'] });
    expect(ticketView(log, 6).jobs[0]).toMatchObject({ owner: 'ben', state: 'accepted', passedBy: ['ana'] });
  });
  it('knows the time and when the plan is locked or stopped', () => {
    expect(ticketView(log, 0).slot).toBeNull();
    expect(ticketView(log, 1).slot).toEqual({ start: 1, end: 2 });
    expect(ticketView(log, 6).committed).toBe(false);
    expect(ticketView(log, 7).committed).toBe(true);
    expect(ticketView([mk(0, 'CANCEL', { reason: 'party_cap' })], 1).cancelled).toBe('party_cap');
  });
});
