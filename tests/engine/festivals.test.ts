import { describe, expect, it } from 'vitest';
import { ALL_FESTIVALS, DEFAULT_FESTIVALS, OPT_IN_FESTIVALS, festivalName, festivalsOfYear, upcomingFestivals } from '../../src/engine/festivals';

const dateOf = (year: number, id: string) => festivalsOfYear(year).find((f) => f.id === id)?.date;

describe('festival dates', () => {
  it('computes fixed and rule-based festivals', () => {
    expect(dateOf(2026, 'halloween')).toBe('2026-10-31');
    expect(dateOf(2026, 'thanksgiving')).toBe('2026-11-26'); // fourth Thursday
    expect(dateOf(2027, 'thanksgiving')).toBe('2027-11-25');
    expect(dateOf(2028, 'thanksgiving')).toBe('2028-11-23');
    expect(dateOf(2026, 'new-years-eve')).toBe('2026-12-31');
    expect(dateOf(2027, 'st-patricks-day')).toBe('2027-03-17');
    expect(dateOf(2027, 'galentines-day')).toBe('2027-02-13');
  });
  it('gets Lunar New Year right, including 2027 where the new moon is eight minutes before midnight in Beijing', () => {
    expect(dateOf(2026, 'lunar-new-year')).toBe('2026-02-17');
    expect(dateOf(2027, 'lunar-new-year')).toBe('2027-02-06');
    expect(dateOf(2028, 'lunar-new-year')).toBe('2028-01-26');
    expect(dateOf(2029, 'lunar-new-year')).toBe('2029-02-13');
  });
  it('falls back to the runtime calendar, marked approximate, for years outside the table', () => {
    const f = festivalsOfYear(2040).find((x) => x.id === 'lunar-new-year');
    expect(f?.approx).toBe(true);
    expect(f?.date).toMatch(/^2040-0[12]-\d\d$/);
  });
  it('computes the Eids from the Islamic calendar and marks them approximate', () => {
    expect(dateOf(2026, 'eid-al-fitr')).toBe('2026-03-20');
    expect(dateOf(2026, 'eid-al-adha')).toBe('2026-05-27');
    expect(festivalsOfYear(2026).find((f) => f.id === 'eid-al-fitr')!.approx).toBe(true);
  });
  it('has Diwali for the years it knows, marked approximate', () => {
    expect(dateOf(2026, 'diwali')).toBe('2026-11-08');
    expect(festivalsOfYear(2026).find((f) => f.id === 'diwali')!.approx).toBe(true);
    expect(dateOf(2040, 'diwali')).toBeUndefined();
  });
  it('returns each year sorted by date, with no duplicates', () => {
    const list = festivalsOfYear(2027);
    expect(list.map((f) => f.date)).toEqual([...list.map((f) => f.date)].sort());
    expect(new Set(list.map((f) => f.id)).size).toBe(list.length);
  });
});

describe('what is on by default', () => {
  it('keeps culturally specific festivals opt-in', () => {
    expect(DEFAULT_FESTIVALS).toEqual(['halloween', 'thanksgiving', 'new-years-eve', 'st-patricks-day', 'galentines-day']);
    expect(OPT_IN_FESTIVALS).toEqual(['diwali', 'lunar-new-year', 'eid-al-fitr', 'eid-al-adha']);
    for (const id of ALL_FESTIVALS) expect(festivalName(id), id).toBeTruthy();
  });
});

describe('upcomingFestivals', () => {
  it('finds only what is within the window and enabled, soonest first', () => {
    const found = upcomingFestivals('2026-10-20', 14, DEFAULT_FESTIVALS);
    expect(found.map((f) => [f.id, f.daysAway])).toEqual([['halloween', 11]]);
    expect(upcomingFestivals('2026-11-15', 14, DEFAULT_FESTIVALS).map((f) => f.id)).toEqual(['thanksgiving']);
  });
  it('ignores opt-in festivals until they are enabled', () => {
    expect(upcomingFestivals('2026-10-30', 14, DEFAULT_FESTIVALS).map((f) => f.id)).not.toContain('diwali');
    expect(upcomingFestivals('2026-10-30', 14, [...DEFAULT_FESTIVALS, 'diwali']).map((f) => f.id)).toContain('diwali');
  });
  it('looks into next year from late December', () => {
    expect(upcomingFestivals('2026-12-28', 45, [...DEFAULT_FESTIVALS, 'lunar-new-year']).map((f) => f.id)).toEqual(['new-years-eve', 'lunar-new-year']);
  });
  it('includes today and excludes yesterday', () => {
    expect(upcomingFestivals('2026-10-31', 0, DEFAULT_FESTIVALS).map((f) => f.id)).toEqual(['halloween']);
    expect(upcomingFestivals('2026-11-01', 5, DEFAULT_FESTIVALS)).toEqual([]);
  });
  it('is empty when nothing is enabled', () => {
    expect(upcomingFestivals('2026-10-25', 30, [])).toEqual([]);
  });
});
