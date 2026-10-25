import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Governor } from '../../src/engine/governor';
import { newPair, reducePair } from '../../src/engine/pair';
import { newParty, reduceParty, type PartyEvent } from '../../src/engine/party';
import { PrivateCalendar, MessageSchema, type Message } from '../../src/engine/protocol';
import { DAY, HOUR } from '../../src/engine/time';
import { DEFAULT_PREFS, type Interval, type Prefs } from '../../src/engine/types';

const T = Date.UTC(2026, 9, 26, 16);
const window: Interval = { start: T, end: T + 7 * DAY };

describe('privacy: no private label or dietary need ever appears in a message', () => {
  it('holds over random calendars, diets and plans', () => {
    const personArb = fc.record({
      busy: fc.array(fc.tuple(fc.integer({ min: 0, max: 7 * 24 }), fc.integer({ min: 1, max: 8 })), { maxLength: 8 }),
      diet: fc.boolean(),
      car: fc.boolean(),
      host: fc.boolean(),
      acceptsTasks: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(personArb, { minLength: 4, maxLength: 8 }), fc.boolean(), (raw, surprise) => {
        const ids = raw.map((_, i) => `s${i}`);
        const labels: string[] = [];
        const diets: string[] = [];
        const prefs: Record<string, Prefs> = {};
        const calendars: Record<string, PrivateCalendar> = {};
        raw.forEach((r, i) => {
          const id = ids[i]!;
          const events = r.busy.map(([h, len], k) => {
            const label = `LABEL_${i}_${k}_zq`;
            labels.push(label);
            return { interval: { start: T + h * HOUR, end: T + (h + len) * HOUR }, label };
          });
          calendars[id] = new PrivateCalendar(events);
          const diet = r.diet ? [`DIET_${i}_zq`] : [];
          diets.push(...diet);
          prefs[id] = { ...DEFAULT_PREFS, hasCar: r.car, canHost: r.host, dietary: diet, interests: [`INT_${i}_zq`] };
        });

        const governor = new Governor();
        let ledger = { load: {} as Record<string, number> };
        let plan = newParty({ id: 'pp', circle: 'c', occasion: 'birthday', host: ids[0]!, honoree: ids[1]!, surprise, guests: ids });
        const all: Message[] = [];
        let n = 0;
        const fire = (type: PartyEvent['type'], extra: Partial<PartyEvent> = {}) => {
          const step = reduceParty(plan, { id: `e${n++}`, at: T + n, type, ...extra }, { people: prefs, ledger, governor, window, durationMs: 2 * HOUR });
          plan = step.plan;
          ledger = step.ledger;
          all.push(...step.out);
        };
        fire('start', { person: ids[0]! });
        for (const id of ids) fire('availability', { person: id, free: calendars[id]!.shared(id, window).free });
        for (const id of ids) fire('rsvp_yes', { person: id });
        for (const spec of plan.tasks?.specs ?? []) {
          const owner = plan.tasks!.owner[spec.id];
          if (owner) fire(raw[ids.indexOf(owner)]!.acceptsTasks ? 'task_accept' : 'task_decline', { person: owner, taskId: spec.id });
        }
        fire('timeout');

        const pairGov = new Governor();
        let pair = newPair({ id: 'px', a: ids[0]!, b: ids[2]!, interval: { start: T + DAY, end: T + DAY + HOUR } });
        for (const type of ['start', 'a_yes', 'b_no'] as const) {
          const step = reducePair(pair, { id: type, at: T, type }, { governor: pairGov });
          pair = step.plan;
          all.push(...step.out);
        }

        const text = JSON.stringify(all);
        for (const secret of [...labels, ...diets, ...ids.map((_, i) => `INT_${i}_zq`)]) expect(text).not.toContain(secret);
        for (const m of all) expect(MessageSchema.safeParse(m).success).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});
