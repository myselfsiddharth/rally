import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DAY,
  HOUR,
  atLeast,
  eveningWindows,
  freeFrom,
  intersect,
  intersectAll,
  localParts,
  merge,
  quietBlocks,
  subtract,
} from '../../src/engine/time';
import type { Interval } from '../../src/engine/types';

const iv = (start: number, end: number): Interval => ({ start, end });
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

describe('merge', () => {
  it('sorts, merges overlapping and touching intervals, drops zero-length', () => {
    expect(merge([iv(10, 20), iv(0, 5), iv(5, 8), iv(15, 30), iv(40, 40)])).toEqual([iv(0, 8), iv(10, 30)]);
  });
  it('handles empty input', () => {
    expect(merge([])).toEqual([]);
  });
  it('ignores inverted intervals', () => {
    expect(merge([iv(10, 5)])).toEqual([]);
  });
});

describe('intersect, subtract, atLeast', () => {
  it('intersects two lists', () => {
    expect(intersect([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(5, 10), iv(20, 25)]);
  });
  it('intersects many lists', () => {
    expect(intersectAll([[iv(0, 100)], [iv(10, 60)], [iv(50, 90)]])).toEqual([iv(50, 60)]);
  });
  it('intersectAll of nothing is empty', () => {
    expect(intersectAll([])).toEqual([]);
  });
  it('subtracts', () => {
    expect(subtract([iv(0, 100)], [iv(10, 20), iv(50, 60)])).toEqual([iv(0, 10), iv(20, 50), iv(60, 100)]);
  });
  it('drops windows shorter than the minimum', () => {
    expect(atLeast([iv(0, 30 * 60_000), iv(0, 2 * HOUR)], HOUR)).toEqual([iv(0, 2 * HOUR)]);
  });
});

describe('freeFrom', () => {
  const window = iv(0, 10 * HOUR);
  it('gives the whole window when nothing is busy', () => {
    expect(freeFrom([], window)).toEqual([window]);
  });
  it('handles unsorted, overlapping, zero-length and out-of-window blocks', () => {
    const busy = [iv(5 * HOUR, 6 * HOUR), iv(1 * HOUR, 3 * HOUR), iv(2 * HOUR, 4 * HOUR), iv(7 * HOUR, 7 * HOUR), iv(-5 * HOUR, 30 * 60_000), iv(9 * HOUR, 20 * HOUR)];
    expect(freeFrom(busy, window)).toEqual([iv(30 * 60_000, 1 * HOUR), iv(4 * HOUR, 5 * HOUR), iv(6 * HOUR, 9 * HOUR)]);
  });
  it('handles a block spanning midnight', () => {
    const night = iv(utc(2026, 10, 24, 23), utc(2026, 10, 25, 7));
    const day = iv(utc(2026, 10, 24), utc(2026, 10, 25, 12));
    expect(freeFrom([night], day)).toEqual([iv(utc(2026, 10, 24), utc(2026, 10, 24, 23)), iv(utc(2026, 10, 25, 7), utc(2026, 10, 25, 12))]);
  });
  it('property: free never overlaps busy and free plus busy covers the window', () => {
    const arb = fc.array(fc.tuple(fc.integer({ min: -50, max: 150 }), fc.integer({ min: 0, max: 60 })), { maxLength: 12 });
    fc.assert(
      fc.property(arb, (raw) => {
        const busy = raw.map(([s, len]) => iv(s, s + len));
        const w = iv(0, 100);
        const free = freeFrom(busy, w);
        const clippedBusy = intersect(merge(busy), [w]);
        expect(intersect(free, clippedBusy)).toEqual([]);
        const covered = merge([...free, ...clippedBusy]);
        expect(covered).toEqual([w]);
      }),
    );
  });
});

describe('localParts', () => {
  it('reads Phoenix local time (UTC-7, no DST)', () => {
    const p = localParts(utc(2026, 10, 24, 1, 30), 'America/Phoenix');
    expect(p).toMatchObject({ hour: 18, minute: 30, dow: 5, dateKey: '2026-10-23' });
  });
});

describe('eveningWindows', () => {
  it('is 17:00 to 22:00 local every day in Phoenix', () => {
    const week = iv(utc(2026, 10, 26), utc(2026, 11, 2));
    const out = eveningWindows(week, 'America/Phoenix');
    expect(out).toHaveLength(7);
    for (const w of out) expect(w.end - w.start).toBe(5 * HOUR);
    expect(out[0]).toEqual(iv(utc(2026, 10, 26, 0), utc(2026, 10, 26, 5)));
  });
  it('stays 17:00 to 22:00 local on the fall-back day in New York', () => {
    const day = iv(utc(2026, 11, 1, 12), utc(2026, 11, 2, 12));
    expect(eveningWindows(day, 'America/New_York')).toEqual([iv(utc(2026, 11, 1, 22), utc(2026, 11, 2, 3))]);
  });
  it('stays 17:00 to 22:00 local on the spring-forward day in New York', () => {
    const day = iv(utc(2026, 3, 8, 12), utc(2026, 3, 9, 12));
    expect(eveningWindows(day, 'America/New_York')).toEqual([iv(utc(2026, 3, 8, 21), utc(2026, 3, 9, 2))]);
  });
  it('clips to the window', () => {
    const w = iv(utc(2026, 10, 27, 1), utc(2026, 10, 27, 3));
    expect(eveningWindows(w, 'America/Phoenix')).toEqual([w]);
  });
});

describe('quietBlocks', () => {
  it('covers 22:00 to 08:00 local overnight', () => {
    const w = iv(utc(2026, 10, 26, 7), utc(2026, 10, 28, 7)); // Phoenix: Oct 26 00:00 to Oct 28 00:00
    const blocks = quietBlocks(w, 'America/Phoenix', 22, 8);
    expect(blocks[0]).toEqual(iv(utc(2026, 10, 26, 7), utc(2026, 10, 26, 15))); // 00:00-08:00 local
    expect(blocks[1]).toEqual(iv(utc(2026, 10, 27, 5), utc(2026, 10, 27, 15))); // 22:00 to 08:00 next day
    expect(blocks[2]).toEqual(iv(utc(2026, 10, 28, 5), utc(2026, 10, 28, 7)));
  });
});

describe('constants', () => {
  it('has sensible units', () => {
    expect(DAY).toBe(24 * HOUR);
  });
});

import { startOfLocalDay } from '../../src/engine/time';
describe('startOfLocalDay', () => {
  it('finds local midnight, including on a daylight-saving day', () => {
    expect(startOfLocalDay(Date.UTC(2026, 9, 24, 3), 'America/Phoenix')).toBe(Date.UTC(2026, 9, 23, 7));
    expect(startOfLocalDay(Date.UTC(2026, 10, 1, 12), 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 4));
    expect(startOfLocalDay(Date.UTC(2026, 10, 2, 3), 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 4));
  });
});

import { isValidTimezone, localToInstant } from '../../src/engine/time';
describe('localToInstant and isValidTimezone', () => {
  it('turns a local date and time into the right instant, across daylight saving', () => {
    expect(localToInstant(2026, 11, 14, 19, 30, 'America/Phoenix')).toBe(Date.UTC(2026, 10, 15, 2, 30));
    expect(localToInstant(2026, 11, 2, 19, 30, 'America/New_York')).toBe(Date.UTC(2026, 10, 3, 0, 30)); // after fall back: UTC-5
    expect(localToInstant(2026, 10, 30, 19, 30, 'America/New_York')).toBe(Date.UTC(2026, 9, 30, 23, 30)); // before: UTC-4
    expect(localToInstant(2026, 3, 9, 8, 0, 'Asia/Kolkata')).toBe(Date.UTC(2026, 2, 9, 2, 30));
  });
  it('accepts real zone names and rejects anything else', () => {
    for (const ok of ['America/New_York', 'America/Phoenix', 'Europe/London', 'Asia/Kolkata', 'UTC', 'America/Argentina/Buenos_Aires']) expect(isValidTimezone(ok)).toBe(true);
    for (const bad of ['', 'nope', 'Mars/Base', 'EST', 'America/New_York; drop table', '../etc/passwd']) expect(isValidTimezone(bad)).toBe(false);
  });
});
