import { pairKey, type Governor } from './governor';
import { DAY, HOUR, atLeast, eveningWindows, intersect, intersectAll } from './time';
import type { Interval, Ms, PersonId, Prefs } from './types';

export const sortedPairKey = pairKey;

export interface PairInput {
  people: { id: PersonId; prefs: Prefs; free: Interval[] }[];
  /** When each pair last met, keyed by sortedPairKey. Missing means "a long time ago". */
  lastMet: Record<string, Ms>;
  now: Ms;
  window: Interval;
  governor: Governor;
  /** Do not propose anything starting sooner than this after `now`. */
  minLeadMs?: Ms;
  /** Only friends are matched. Defaults to everyone. */
  areFriends?: (a: PersonId, b: PersonId) => boolean;
}

export interface PairProposal {
  a: PersonId;
  b: PersonId;
  interval: Interval;
  score: number;
}

const LONG_AGO_DAYS = 60;

/**
 * One round of 1-on-1 matchmaking. Each person appears at most once. `a` is the person asked first: whoever has
 * received fewer invites lately.
 */
export function proposePairs(input: PairInput): PairProposal[] {
  const { people, lastMet, now, governor } = input;
  const window = { start: Math.max(input.window.start, now + (input.minLeadMs ?? 2 * HOUR)), end: input.window.end };
  if (window.end <= window.start) return [];

  const candidates: (PairProposal & { key: string })[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const x = people[i]!;
      const y = people[j]!;
      if (input.areFriends && !input.areFriends(x.id, y.id)) continue;
      if (!governor.canInvitePair(x, y, now).ok) continue;
      const evenings = intersect(eveningWindows(window, x.prefs.tz), eveningWindows(window, y.prefs.tz));
      const shared = atLeast(intersectAll([x.free, y.free, evenings]), HOUR);
      if (shared.length === 0) continue;
      const first = shared[0]!;
      const since = lastMet[pairKey(x.id, y.id)];
      const days = since === undefined ? LONG_AGO_DAYS : Math.min(LONG_AGO_DAYS, Math.max(0, (now - since) / DAY));
      const common = x.prefs.interests.filter((t) => y.prefs.interests.includes(t)).length;
      const cx = governor.recentInviteCount(x.id, now);
      const cy = governor.recentInviteCount(y.id, now);
      const [a, b] = cx < cy || (cx === cy && x.id < y.id) ? [x, y] : [y, x];
      candidates.push({ a: a.id, b: b.id, interval: { start: first.start, end: first.start + HOUR }, score: days + 5 * common, key: pairKey(x.id, y.id) });
    }
  }
  candidates.sort((p, q) => q.score - p.score || (p.key < q.key ? -1 : 1));
  const used = new Set<PersonId>();
  const out: PairProposal[] = [];
  for (const c of candidates) {
    if (used.has(c.a) || used.has(c.b)) continue;
    used.add(c.a);
    used.add(c.b);
    out.push({ a: c.a, b: c.b, interval: c.interval, score: c.score });
  }
  return out;
}
