import { describe, expect, it } from 'vitest';
import { findSlots, type Candidate } from '../../src/engine/slots';
import { HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS, type Interval } from '../../src/engine/types';

/** Phoenix local time (UTC-7, no DST) to a UTC instant. */
const phx = (m: number, d: number, h: number, min = 0) => Date.UTC(2026, m - 1, d, h + 7, min);
const iv = (start: number, end: number): Interval => ({ start, end });
const person = (id: string, free: Interval[]): Candidate => ({ id, free, prefs: DEFAULT_PREFS });

// Mon Oct 26 to Sun Nov 1 2026, local
const week = iv(phx(10, 26, 0), phx(11, 1, 24));
const allWeek = (id: string) => person(id, [week]);

describe('findSlots', () => {
  it('prefers a Friday evening over a weekday noon when everyone is free', () => {
    const res = findSlots([allWeek('ana'), allWeek('ben'), allWeek('cy')], 2 * HOUR, week);
    expect(res.kind).toBe('slots');
    if (res.kind !== 'slots') return;
    const best = res.options[0]!;
    expect(best.interval.start).toBe(phx(10, 30, 17)); // Friday 17:00
    expect(best.attendees).toEqual(['ana', 'ben', 'cy']);
    expect(best.leftOut).toEqual([]);
  });

  it('names who is left out when nobody can do a common time', () => {
    const fri = iv(phx(10, 30, 18), phx(10, 30, 21));
    const people = [person('ana', [fri]), person('ben', [fri]), person('cy', [fri]), person('dee', [iv(phx(10, 27, 10), phx(10, 27, 11))])];
    const res = findSlots(people, 2 * HOUR, week);
    expect(res.kind).toBe('slots');
    if (res.kind !== 'slots') return;
    expect(res.options[0]!.attendees).toEqual(['ana', 'ben', 'cy']);
    expect(res.options[0]!.leftOut).toEqual([{ id: 'dee', reason: 'no_overlap' }]);
  });

  it('returns none when nobody overlaps', () => {
    const a = person('ana', [iv(phx(10, 27, 10), phx(10, 27, 13))]);
    const b = person('ben', [iv(phx(10, 28, 10), phx(10, 28, 13))]);
    expect(findSlots([a, b], 2 * HOUR, week)).toEqual({ kind: 'none', reason: 'no_overlap' });
  });

  it('returns too_small for a group of one', () => {
    expect(findSlots([allWeek('ana')], HOUR, week)).toEqual({ kind: 'none', reason: 'too_small' });
    expect(findSlots([], HOUR, week)).toEqual({ kind: 'none', reason: 'too_small' });
  });

  it('leaves out a person whose only free time is in quiet hours', () => {
    const night = iv(phx(10, 30, 23), phx(10, 31, 2));
    const res = findSlots([allWeek('ana'), allWeek('ben'), person('cy', [night])], HOUR, week);
    expect(res.kind).toBe('slots');
    if (res.kind !== 'slots') return;
    expect(res.options[0]!.leftOut.map((l) => l.id)).toEqual(['cy']);
  });

  it('returns none when the duration is longer than any shared window', () => {
    const short = iv(phx(10, 30, 18), phx(10, 30, 19));
    expect(findSlots([person('ana', [short]), person('ben', [short])], 2 * HOUR, week)).toEqual({ kind: 'none', reason: 'no_overlap' });
  });

  it('is deterministic and sorted by left-out, then penalty, then start', () => {
    const people = [allWeek('ana'), allWeek('ben')];
    const a = findSlots(people, 2 * HOUR, week);
    const b = findSlots(people, 2 * HOUR, week);
    expect(a).toEqual(b);
    if (a.kind !== 'slots') throw new Error('expected slots');
    for (let i = 1; i < a.options.length; i++) {
      const p = a.options[i - 1]!;
      const q = a.options[i]!;
      const key = (o: typeof p) => [o.leftOut.length, o.penalty, o.interval.start] as const;
      const [a0, a1, a2] = key(p);
      const [b0, b1, b2] = key(q);
      const inOrder = a0 < b0 || (a0 === b0 && (a1 < b1 || (a1 === b1 && a2 <= b2)));
      expect(inOrder).toBe(true);
    }
  });

  it('returns distinct, non-overlapping options', () => {
    const res = findSlots([allWeek('ana'), allWeek('ben')], 2 * HOUR, week, { maxResults: 4 });
    if (res.kind !== 'slots') throw new Error('expected slots');
    for (let i = 0; i < res.options.length; i++) {
      for (let j = i + 1; j < res.options.length; j++) {
        const x = res.options[i]!.interval;
        const y = res.options[j]!.interval;
        expect(x.end <= y.start || y.end <= x.start).toBe(true);
      }
    }
  });
});
