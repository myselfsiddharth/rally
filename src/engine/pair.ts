import type { Governor } from './governor';
import { msg, type Message } from './protocol';
import type { Interval, Ms, PersonId } from './types';

export interface PairPlan {
  id: string;
  a: PersonId;
  b: PersonId;
  interval: Interval;
  status: 'new' | 'asking_a' | 'asking_b' | 'confirmed' | 'dropped';
  seen: string[];
  seq: number;
}

export type PairEvent = { id: string; at: Ms; type: 'start' | 'a_yes' | 'a_no' | 'b_yes' | 'b_no' | 'timeout' | 'withdraw'; person?: PersonId };

export function newPair(p: { id: string; a: PersonId; b: PersonId; interval: Interval }): PairPlan {
  return { ...p, status: 'new', seen: [], seq: 0 };
}

/**
 * Double opt-in. B is only asked after A says yes, so nobody learns they were turned down:
 * a "no" from A is never mentioned to B, and a "no" from B tells A only "not this time".
 */
export function reducePair(plan: PairPlan, ev: PairEvent, ctx: { governor: Governor }): { plan: PairPlan; out: Message[] } {
  if (plan.seen.includes(ev.id)) return { plan, out: [] };
  const p: PairPlan = structuredClone(plan);
  p.seen.push(ev.id);
  const out: Message[] = [];
  const say = (from: string, to: string, kind: Message['kind'], body: Record<string, unknown> = {}) => out.push(msg(p.id, p.seq++, ev.at, from, to, kind, body));
  const ignore = () => ({ plan, out: [] as Message[] });

  switch (ev.type) {
    case 'start':
      if (p.status !== 'new') return ignore();
      p.status = 'asking_a';
      ctx.governor.recordPairInvite(p.a, ev.at);
      say('coordinator', p.a, 'PAIR_ASK', { interval: p.interval, with: p.b });
      return { plan: p, out };
    case 'a_yes':
      if (p.status !== 'asking_a') return ignore();
      p.status = 'asking_b';
      ctx.governor.recordPairInvite(p.b, ev.at);
      say('coordinator', p.b, 'PAIR_ASK', { interval: p.interval, with: p.a });
      return { plan: p, out };
    case 'a_no':
      if (p.status !== 'asking_a') return ignore();
      p.status = 'dropped';
      ctx.governor.recordDecline(p.a, p.b, ev.at);
      say(p.a, 'coordinator', 'PAIR_NO');
      return { plan: p, out };
    case 'b_yes':
      if (p.status !== 'asking_b') return ignore();
      p.status = 'confirmed';
      say('coordinator', p.a, 'PAIR_YES', { interval: p.interval, with: p.b });
      say('coordinator', p.b, 'PAIR_YES', { interval: p.interval, with: p.a });
      return { plan: p, out };
    case 'b_no':
      if (p.status !== 'asking_b') return ignore();
      p.status = 'dropped';
      ctx.governor.recordDecline(p.a, p.b, ev.at);
      say(p.b, 'coordinator', 'PAIR_NO');
      say('coordinator', p.a, 'PAIR_NO', { text: 'Not this time.' });
      return { plan: p, out };
    case 'withdraw': {
      if (p.status !== 'confirmed' || (ev.person !== p.a && ev.person !== p.b)) return ignore();
      p.status = 'dropped';
      say('coordinator', ev.person === p.a ? p.b : p.a, 'WITHDREW', { person: ev.person, interval: p.interval });
      return { plan: p, out };
    }
    case 'timeout':
      if (p.status !== 'asking_a' && p.status !== 'asking_b') return ignore();
      p.status = 'dropped';
      return { plan: p, out };
  }
}
