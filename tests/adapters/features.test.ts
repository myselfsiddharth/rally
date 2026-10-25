import { describe, expect, it } from 'vitest';
import { DemoCalendar } from '../../src/adapters/calendar/demo';
import { FakeCalendar } from '../../src/adapters/calendar/fake';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { handleInteraction, type InteractionContext } from '../../src/app/interactions';
import { Orchestrator, type PairRecord, type PartyRecord } from '../../src/app/orchestrator';
import { PrivateCalendar } from '../../src/engine/protocol';
import { DAY, HOUR, localToInstant } from '../../src/engine/time';
import { formatSlot } from '../../src/ui/replay';

const phx = (m: number, d: number, h: number) => Date.UTC(2026, m - 1, d, h + 7);
const MON = phx(10, 26, 10);

function demoWorld() {
  const store = new MemoryStore();
  const platform = new FakePlatform();
  const clock = { now: MON };
  const app = new Orchestrator({ store, calendar: new DemoCalendar(store), platform, now: () => clock.now });
  return { store, platform, clock, app };
}
const press = async (w: ReturnType<typeof demoWorld>, person: string, re: RegExp) => {
  const dm = [...w.platform.to(person)].reverse().find((d) => d.buttons.some((b) => re.test(b.id)));
  if (!dm) throw new Error(`no button matching ${re} for ${person}`);
  return w.app.handleButton(person, dm.buttons.find((b) => re.test(b.id))!.id);
};
const takeAllJobs = async (w: ReturnType<typeof demoWorld>, person: string) => {
  for (const d of w.platform.to(person).filter((x) => x.buttons.some((b) => /:task_accept:/.test(b.id)))) {
    await w.app.handleButton(person, d.buttons.find((b) => /:task_accept:/.test(b.id))!.id);
  }
};

async function aloneWithDemoFriends(w: ReturnType<typeof demoWorld>) {
  await w.app.ensurePerson('me', 'Me');
  await w.app.updatePrefs('me', { canHost: true, hasCar: true });
  const circle = await w.app.createCircle('chan', 'me', 'Solo');
  await w.app.addDemoFriends(circle.id, 'me');
  return circle;
}

describe('demo friends', () => {
  it('lets one person watch a whole plan: friends answer by themselves, one passes a job, and it locks in', async () => {
    const w = demoWorld();
    const circle = await aloneWithDemoFriends(w);
    expect((await w.app.status('me')).split('\n')[0]).toContain('demo');
    const res = await w.app.startParty({ circle: circle.id, host: 'me', occasion: 'halloween', title: 'Halloween' });
    expect(res.ok).toBe(true);
    const planId = (res as { planId: string }).planId;
    // the demo friends already said yes; the only person left to answer is the real one
    expect((await w.store.get<PartyRecord>('party', planId))!.plan.rsvp['demo:maya']).toBe('yes');
    expect(w.platform.to('demo:maya')).toEqual([]); // fictional friends are never DMed
    // Omar was asked to host first and passed, so the job came to the real person
    expect(w.platform.to('me').some((d) => d.text.startsWith('Someone had to drop this one'))).toBe(true);
    await takeAllJobs(w, 'me');
    expect((await w.store.get<PartyRecord>('party', planId))!.plan.status).toBe('committed');
    const post = w.platform.posts.at(-1)!;
    expect(post.circle).toBe(circle.id);
    expect(post.text).toContain('locked in');
    expect(post.text).toContain('(demo)');
  });

  it('does not add them twice and labels every one', async () => {
    const w = demoWorld();
    const circle = await aloneWithDemoFriends(w);
    await w.app.addDemoFriends(circle.id, 'me');
    const members = (await w.app.circlesOf('me'))[0]!.members;
    expect(members.filter((m) => m.startsWith('demo:'))).toHaveLength(3);
    for (const m of members.filter((x) => x.startsWith('demo:'))) expect((await w.app.person(m))!.name).toContain('(demo)');
  });
});

describe('announcing in the channel', () => {
  it('posts the plan with who is doing what, once, but never for a surprise', async () => {
    const w = demoWorld();
    const circle = await aloneWithDemoFriends(w);
    const res = (await w.app.startParty({ circle: circle.id, host: 'me', occasion: 'halloween', title: 'Halloween' })) as { planId: string };
    await takeAllJobs(w, 'me');
    expect(w.platform.posts).toHaveLength(1);
    expect(w.platform.posts[0]!.text).toMatch(/Halloween is locked in for .*\n.*: /);
    expect((await w.store.get<PartyRecord>('party', res.planId))!.plan.status).toBe('committed');

    const w2 = demoWorld();
    const c2 = await aloneWithDemoFriends(w2);
    await w2.app.startParty({ circle: c2.id, host: 'me', occasion: 'birthday', honoree: 'demo:priya', surprise: true, title: "Priya's birthday" });
    await takeAllJobs(w2, 'me');
    expect(w2.platform.posts).toEqual([]);
  });
});

describe('reminders', () => {
  async function lockedPlan() {
    const w = demoWorld();
    const circle = await aloneWithDemoFriends(w);
    const res = (await w.app.startParty({ circle: circle.id, host: 'me', occasion: 'halloween', title: 'Halloween' })) as { planId: string };
    await takeAllJobs(w, 'me');
    const rec = (await w.store.get<PartyRecord>('party', res.planId))!;
    return { w, rec, start: rec.plan.slot!.interval.start };
  }
  it('sends one reminder a day before, with the person\'s own jobs, and not before that', async () => {
    const { w, start } = await lockedPlan();
    w.clock.now = start - 30 * HOUR;
    expect((await w.app.tick()).reminders).toBe(0);
    w.clock.now = start - 20 * HOUR;
    const out = await w.app.tick();
    expect(out.reminders).toBeGreaterThan(0);
    const mine = w.platform.to('me').filter((d) => d.text.startsWith('Reminder: Halloween'));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.buttons.some((b) => b.id.endsWith(':withdraw'))).toBe(true);
    w.clock.now = start - 10 * HOUR;
    expect((await w.app.tick()).reminders).toBe(0);
  });
  it('does not remind about something that already started', async () => {
    const { w, start } = await lockedPlan();
    w.clock.now = start + HOUR;
    await w.app.tick();
    expect(w.platform.to('me').some((d) => d.text.startsWith('Reminder: Halloween'))).toBe(false);
  });
});

describe('backing out after it is locked in', () => {
  function realWorld() {
    const names = ['ana', 'ben', 'cy', 'dee'];
    const calendars = Object.fromEntries(names.map((n) => [n, new PrivateCalendar([])]));
    const store = new MemoryStore();
    const calendar = new FakeCalendar(calendars);
    const platform = new FakePlatform();
    const clock = { now: MON };
    const app = new Orchestrator({ store, calendar, platform, now: () => clock.now });
    return { store, calendar, platform, clock, app, names };
  }
  async function locked() {
    const w = realWorld();
    for (const n of w.names) {
      await w.app.ensurePerson(n, n.toUpperCase());
      await w.app.updatePrefs(n, { hasCar: true, canHost: true });
    }
    const circle = await w.app.createCircle('chan', 'ana', 'Four');
    for (const n of w.names.slice(1)) await w.app.joinCircle(circle.code, n);
    const res = (await w.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' })) as { planId: string };
    const act = async (person: string, re: RegExp) => {
      const dm = [...w.platform.to(person)].reverse().find((d) => d.buttons.some((b) => re.test(b.id)));
      return w.app.handleButton(person, dm!.buttons.find((b) => re.test(b.id))!.id);
    };
    for (const n of w.names.slice(1)) await act(n, /:rsvp_yes$/);
    for (const n of w.names) for (const d of w.platform.to(n).filter((x) => x.buttons.some((b) => /:task_accept:/.test(b.id)))) await w.app.handleButton(n, d.buttons.find((b) => /:task_accept:/.test(b.id))!.id);
    return { w, planId: res.planId, act };
  }

  it('lets a guest leave: their calendar event is removed and the host is told', async () => {
    const { w, planId, act } = await locked();
    expect((await w.store.get<PartyRecord>('party', planId))!.plan.status).toBe('committed');
    const leaver = ['dee', 'cy', 'ben'].find((n) => w.calendar.inserted.some((e) => e.person === n))!;
    const before = w.platform.to('ana').length;
    const ack = await act(leaver, /:withdraw$/);
    expect(ack).toContain('you are out');
    expect(w.calendar.deleted.some((d) => d.person === leaver)).toBe(true);
    expect(w.platform.to('ana').slice(before).some((d) => d.text.includes("can't come"))).toBe(true);
    const rec = (await w.store.get<PartyRecord>('party', planId))!;
    expect(rec.plan.rsvp[leaver]).toBe('no');
    expect(rec.eventIds?.[leaver]).toBeUndefined();
  });

  it('cancels for everyone, and clears every calendar, if the host backs out', async () => {
    const { w, planId, act } = await locked();
    await act('ana', /:withdraw$/);
    const rec = (await w.store.get<PartyRecord>('party', planId))!;
    expect(rec.plan.status).toBe('cancelled');
    for (const n of ['ben', 'cy', 'dee']) expect(w.platform.to(n).some((d) => d.text.includes('is off'))).toBe(true);
    expect(new Set(w.calendar.deleted.map((d) => d.person))).toEqual(new Set(w.calendar.inserted.map((e) => e.person)));
    expect((await w.app.tick()).reminders).toBe(0);
  });
});

describe('cancelling a confirmed coffee', () => {
  it('tells the other person and removes both calendar events', async () => {
    const names = ['ana', 'ben', 'cy'];
    const calendars = Object.fromEntries(names.map((n) => [n, new PrivateCalendar([])]));
    const store = new MemoryStore();
    const calendar = new FakeCalendar(calendars);
    const platform = new FakePlatform();
    const app = new Orchestrator({ store, calendar, platform, now: () => MON });
    for (const n of names) await app.ensurePerson(n, n.toUpperCase());
    const c = await app.createCircle('chan', 'ana', 'P');
    for (const n of names.slice(1)) await app.joinCircle(c.code, n);
    await app.tick();
    const first = platform.dms.find((d) => d.text.includes('grab a coffee'))!;
    await app.handleButton(first.person, first.buttons.find((b) => b.id.endsWith(':yes'))!.id);
    const second = platform.dms.filter((d) => d.text.includes('grab a coffee')).at(-1)!;
    await app.handleButton(second.person, second.buttons.find((b) => b.id.endsWith(':yes'))!.id);
    expect(calendar.inserted).toHaveLength(2);
    const confirmed = platform.dms.find((d) => d.buttons.some((b) => b.id.endsWith(':cancel')))!;
    await app.handleButton(confirmed.person, confirmed.buttons.find((b) => b.id.endsWith(':cancel'))!.id);
    const other = [first.person, second.person].find((p) => p !== confirmed.person)!;
    expect(platform.to(other).some((d) => d.text.includes("can't make your coffee"))).toBe(true);
    expect(calendar.deleted.map((d) => d.person).sort()).toEqual([first.person, second.person].sort());
    const pair = (await store.list<PairRecord>('pair')).find((p) => p.plan.status === 'dropped');
    expect(pair).toBeDefined();
  });
});

describe('time zones', () => {
  it('shows each person times in their own zone', async () => {
    const w = demoWorld();
    const circle = await aloneWithDemoFriends(w);
    await w.app.updatePrefs('me', { tz: 'America/New_York' });
    const res = (await w.app.startParty({ circle: circle.id, host: 'demo:maya', occasion: 'hangout', title: 'Hang' })) as { planId: string };
    const slot = (await w.store.get<PartyRecord>('party', res.planId))!.plan.slot!.interval;
    const dm = w.platform.to('me').find((d) => d.text.includes('Can you make it'))!;
    expect(dm.text).toContain(formatSlot(slot, 'America/New_York'));
    expect(formatSlot(slot, 'America/New_York')).not.toBe(formatSlot(slot, 'America/Phoenix'));
  });
});

describe('Discord commands for the new features', () => {
  function ctxFor(w: ReturnType<typeof demoWorld>): InteractionContext {
    return { app: w.app, now: () => w.clock.now, connectUrl: async () => undefined };
  }
  const cmd = (id: string, sub: string, values: Record<string, string | number | boolean> = {}) => ({
    type: 2, channel_id: 'chan', member: { user: { id, username: id } },
    data: { name: 'rally', options: [{ name: sub, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, type: typeof value === 'number' ? 4 : typeof value === 'boolean' ? 5 : 3, value })) }] },
  });
  const say = async (w: ReturnType<typeof demoWorld>, id: string, sub: string, v?: Record<string, string | number | boolean>) => ((await handleInteraction(cmd(id, sub, v), ctxFor(w))).body as any).data.content as string;

  it('/rally demo adds the friends and says they are fictional', async () => {
    const w = demoWorld();
    expect(await say(w, 'me', 'demo')).toContain('Make a circle first');
    await say(w, 'me', 'newcircle', { name: 'Solo' });
    const reply = await say(w, 'me', 'demo');
    expect(reply).toContain('Maya (demo)');
    expect(reply).toContain('fictional');
  });

  it('/rally prefs sets a time zone and rejects an unknown one', async () => {
    const w = demoWorld();
    expect(await say(w, 'me', 'prefs', { timezone: 'Europe/London' })).toContain('Saved');
    expect((await w.app.person('me'))!.prefs.tz).toBe('Europe/London');
    expect(await say(w, 'me', 'prefs', { timezone: 'Mars/Base' })).toContain('do not know that time zone');
    expect((await w.app.person('me'))!.prefs.tz).toBe('Europe/London');
  });

  it('/rally plan concert books exactly the event window in the host\'s time zone', async () => {
    const w = demoWorld();
    await say(w, 'me', 'newcircle', { name: 'Solo' });
    await say(w, 'me', 'demo');
    await say(w, 'me', 'prefs', { timezone: 'America/New_York' });
    const reply = await say(w, 'me', 'plan', { occasion: 'concert', title: 'Desert Echoes', date: '2026-11-14', time: '19:30', hours: 3 });
    expect(reply).toContain('checking everyone');
    const rec = (await w.store.list<PartyRecord>('party'))[0]!;
    expect(rec.title).toBe('Desert Echoes');
    expect(rec.window).toEqual({ start: localToInstant(2026, 11, 14, 19, 30, 'America/New_York'), end: localToInstant(2026, 11, 14, 19, 30, 'America/New_York') + 3 * HOUR });
    expect(rec.durationMs).toBe(3 * HOUR);
    expect(rec.plan.occasion).toBe('concert');
  });

  it('/rally plan concert rejects missing, impossible, past and far-off dates and rude names', async () => {
    const w = demoWorld();
    await say(w, 'me', 'newcircle', { name: 'Solo' });
    await say(w, 'me', 'demo');
    expect(await say(w, 'me', 'plan', { occasion: 'concert' })).toContain('give a date');
    expect(await say(w, 'me', 'plan', { occasion: 'concert', date: '2026-02-30', time: '19:00' })).toContain('give a date');
    expect(await say(w, 'me', 'plan', { occasion: 'concert', date: '2026-11-14', time: '25:00' })).toContain('give a date');
    expect(await say(w, 'me', 'plan', { occasion: 'concert', date: '2026-10-20', time: '19:00' })).toContain('too soon or already past');
    expect(await say(w, 'me', 'plan', { occasion: 'concert', date: '2028-01-01', time: '19:00' })).toContain('six months');
    expect(await say(w, 'me', 'plan', { occasion: 'concert', title: 'you loser', date: '2026-11-14', time: '19:00' })).toContain('different name');
    expect(await w.store.list('party')).toEqual([]);
  });

  it('the command list fits Discord limits including the new options', async () => {
    const { RALLY_COMMAND, TIMEZONES } = await import('../../src/adapters/platform/commands');
    expect(TIMEZONES.length).toBeLessThanOrEqual(25);
    const prefs = RALLY_COMMAND.options.find((o) => o.name === 'prefs') as unknown as { options: { name: string; choices?: unknown[] }[] };
    expect(prefs.options.find((o) => o.name === 'timezone')!.choices).toHaveLength(TIMEZONES.length);
    expect(RALLY_COMMAND.options.length).toBeLessThanOrEqual(25);
    expect(RALLY_COMMAND.options.some((o) => o.name === 'demo')).toBe(true);
  });
});

void DAY;
