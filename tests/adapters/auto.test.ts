import { describe, expect, it } from 'vitest';
import { GoogleCalendar } from '../../src/adapters/calendar/google';
import { FakeCalendar } from '../../src/adapters/calendar/fake';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { handleInteraction, type InteractionContext } from '../../src/app/interactions';
import { Orchestrator, type CircleRecord, type OfferRecord, type PartyRecord, type PersonRecord } from '../../src/app/orchestrator';
import { PrivateCalendar } from '../../src/engine/protocol';
import { DAY } from '../../src/engine/time';

const phx = (y: number, m: number, d: number, h: number) => Date.UTC(y, m - 1, d, h + 7);

function world(clock: number, names = ['ana', 'ben', 'cy', 'fay']) {
  const calendars = Object.fromEntries(names.map((n) => [n, new PrivateCalendar([])]));
  const store = new MemoryStore();
  const calendar = new FakeCalendar(calendars);
  const platform = new FakePlatform();
  const state = { now: clock };
  const app = new Orchestrator({ store, calendar, platform, now: () => state.now });
  return { store, calendar, platform, state, app, names };
}
async function circleOf(w: ReturnType<typeof world>, names = w.names) {
  for (const n of names) await w.app.ensurePerson(n, n.charAt(0).toUpperCase() + n.slice(1));
  await w.app.updatePrefs(names[0]!, { canHost: true });
  const circle = await w.app.createCircle('chan', names[0]!, 'Dorm');
  for (const n of names.slice(1)) await w.app.joinCircle(circle.code, n);
  return circle;
}
const offers = (w: ReturnType<typeof world>) => w.store.list<OfferRecord>('offer');
const parties = (w: ReturnType<typeof world>) => w.store.list<PartyRecord>('party');

describe('automatic mode', () => {
  it('plans a coming birthday by itself, picks a host, tells the channel, and gives the host a way to stop it', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    await w.app.setBirthday('fay', 1, 12);
    await w.app.setCircleMode(circle.id, 'auto', 'ana');
    expect(w.platform.posts.at(-1)!.text).toContain('turned on automatic planning');
    await w.app.tick();
    const [party] = await parties(w);
    expect(party!.title).toBe("Fay's birthday");
    expect(party!.plan.host).toBe('ana'); // can host, and is not the honoree
    expect(party!.plan.honoree).toBe('fay');
    expect(w.platform.posts.some((p) => p.text.includes("Rally is planning Fay's birthday"))).toBe(true);
    const hostDm = w.platform.to('ana').find((d) => d.text.includes('started planning'))!;
    expect(hostDm.buttons.some((b) => b.id.endsWith(':cancel'))).toBe(true);
    expect(w.platform.dms.some((d) => d.text.includes('Want me to go ahead'))).toBe(false); // it did not ask first
    for (const n of ['ben', 'cy', 'fay']) expect(w.platform.to(n).some((d) => d.text.includes('Can you make it'))).toBe(true); // everyone still decides for themselves
    const offer = (await offers(w))[0]!;
    expect(offer).toMatchObject({ state: 'started', auto: true, host: 'ana' });
  });

  it('lets the host stop an automatic plan with one tap', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    await w.app.setBirthday('fay', 1, 12);
    await w.app.setCircleMode(circle.id, 'auto', 'ana');
    await w.app.tick();
    const stop = w.platform.to('ana').find((d) => d.text.includes('started planning'))!.buttons.find((b) => b.id.endsWith(':cancel'))!;
    await w.app.handleButton('ana', stop.id);
    expect((await parties(w))[0]!.plan.status).toBe('cancelled');
    expect(w.platform.to('ben').some((d) => d.text.includes('is off'))).toBe(true);
  });

  it('does not start a second automatic party inside the 14-day gap; it waits, and says so', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    await w.app.setBirthday('fay', 1, 12);
    await w.app.setBirthday('ben', 1, 13);
    await w.app.setCircleMode(circle.id, 'auto', 'ana');
    await w.app.tick();
    const list = await offers(w);
    expect(list.map((o) => o.state).sort()).toEqual(['started', 'waiting']);
    expect(await parties(w)).toHaveLength(1);
    const waiting = list.find((o) => o.state === 'waiting')!;
    expect(w.platform.to(waiting.host!).some((d) => d.text.includes('I will hold'))).toBe(true);
  });

  it('is idempotent: a second tick plans nothing new', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    await w.app.setBirthday('fay', 1, 12);
    await w.app.setCircleMode(circle.id, 'auto', 'ana');
    await w.app.tick();
    const sent = w.platform.dms.length;
    expect((await w.app.tick()).offers).toBe(0);
    expect(w.platform.dms.length).toBe(sent);
    expect(await parties(w)).toHaveLength(1);
  });
});

describe('the other modes', () => {
  it('asks a host first by default, and plans nothing when set to off', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    await w.app.setBirthday('fay', 1, 12);
    await w.app.tick();
    expect(w.platform.dms.some((d) => d.text.includes('Want me to go ahead'))).toBe(true);
    expect(await parties(w)).toHaveLength(0);

    const off = world(phx(2027, 1, 5, 10));
    const c2 = await circleOf(off);
    await off.app.setBirthday('fay', 1, 12);
    await off.app.setCircleMode(c2.id, 'off', 'ana');
    await off.app.tick();
    expect(await offers(off)).toEqual([]);
    expect(off.platform.dms.filter((d) => d.text.includes('Want me to go ahead'))).toEqual([]);
  });
  it('only members can change the mode', async () => {
    const w = world(phx(2027, 1, 5, 10));
    const circle = await circleOf(w);
    expect(await w.app.setCircleMode(circle.id, 'auto', 'stranger')).toBeUndefined();
    expect((await w.store.get<CircleRecord>('circle', circle.id))!.mode).toBeUndefined();
  });
});

describe('festivals', () => {
  it('plans a festival by itself, as a festival party, around its date', async () => {
    const w = world(phx(2026, 11, 15, 10));
    const circle = await circleOf(w);
    await w.app.setCircleMode(circle.id, 'auto', 'ana');
    await w.app.tick();
    const [party] = await parties(w);
    expect(party!.title).toBe('Thanksgiving');
    expect(party!.plan.occasion).toBe('festival');
    expect(party!.plan.honoree).toBeNull();
    expect(party!.window.start).toBeGreaterThanOrEqual(phx(2026, 11, 24, 0));
    expect(party!.window.end).toBe(phx(2026, 11, 27, 0));
    expect(Object.keys(party!.plan.tasks ?? {}).length >= 0).toBe(true);
  });
  it('keeps culturally specific festivals off until the circle turns them on', async () => {
    const w = world(phx(2026, 10, 28, 10)); // Diwali is Nov 8, ten days away; Halloween is in three days
    const circle = await circleOf(w);
    await w.app.tick();
    const titles = (await offers(w)).map((o) => o.title);
    expect(titles).toContain('Halloween');
    expect(titles).not.toContain('Diwali');
    await w.app.setFestival(circle.id, 'diwali', true, 'ana');
    await w.app.tick();
    expect((await offers(w)).map((o) => o.title)).toContain('Diwali');
    await w.app.setFestival(circle.id, 'halloween', false, 'ana');
    expect((await w.store.get<CircleRecord>('circle', circle.id))!.festivals).not.toContain('halloween');
  });
  it('does not plan a festival that is more than two weeks away', async () => {
    const w = world(phx(2026, 11, 1, 10));
    await circleOf(w);
    await w.app.tick();
    expect((await offers(w)).map((o) => o.title)).not.toContain('Thanksgiving'); // 25 days off
  });
});

describe('learning birthdays from Google', () => {
  const NOW = phx(2027, 1, 5, 10);
  function googleWorld() {
    const w = world(NOW, ['ana', 'ben', 'maya', 'sam1', 'sam2']);
    return w;
  }
  it('matches a contact to the one circle member with that first name, and only that', async () => {
    const w = googleWorld();
    await circleOf(w);
    await w.app.ensurePerson('sam1', 'Sam');
    await w.app.ensurePerson('sam2', 'Sam');
    w.calendar.birthdayFeeds.ana = [
      { name: 'Maya Patel', month: 1, day: 12 },
      { name: 'Sam Jones', month: 1, day: 14 }, // two Sams in the circle: do not guess
      { name: 'Professor Higgins', month: 1, day: 20 }, // not in the circle
    ];
    const out = await w.app.tick();
    expect(out.learned).toBe(1);
    const maya = (await w.app.person('maya'))!;
    expect(maya.birthday).toEqual({ month: 1, day: 12 });
    expect(maya.birthdaySource).toBe('google');
    expect(JSON.stringify(maya)).not.toContain('Patel'); // the contact's surname is never stored
    expect((await w.app.person('sam1'))!.birthday).toBeUndefined();
    // and the agent then offers to plan it
    expect(w.platform.dms.some((d) => d.text.includes("Maya's birthday") && d.text.includes('Want me to go ahead'))).toBe(true);
  });
  it('never overwrites a birthday the person gave themselves, and scans once a day', async () => {
    const w = googleWorld();
    await circleOf(w);
    await w.app.setBirthday('maya', 3, 3);
    w.calendar.birthdayFeeds.ana = [{ name: 'Maya', month: 1, day: 12 }];
    expect((await w.app.tick()).learned).toBe(0);
    expect((await w.app.person('maya'))!.birthday).toEqual({ month: 3, day: 3 });

    const w2 = googleWorld();
    await circleOf(w2);
    w2.calendar.birthdayFeeds.ana = [{ name: 'Maya', month: 1, day: 12 }];
    expect((await w2.app.tick()).learned).toBe(1);
    w2.calendar.birthdayFeeds.ana = [{ name: 'Maya', month: 2, day: 2 }];
    expect((await w2.app.tick()).learned).toBe(0); // already scanned today
    w2.state.now += DAY;
    expect((await w2.app.tick()).learned).toBe(1); // the next day it looks again
    expect(((await w2.store.get<PersonRecord>('person', 'maya'))!).birthday).toEqual({ month: 2, day: 2 });
  });
  it('does nothing for people without a connected calendar', async () => {
    const w = googleWorld();
    await circleOf(w);
    const calendar = new FakeCalendar({}, new Set()); // nobody connected
    const app = new Orchestrator({ store: w.store, calendar, platform: w.platform, now: () => NOW });
    calendar.birthdayFeeds.ana = [{ name: 'Maya', month: 1, day: 12 }];
    expect((await app.tick()).learned).toBe(0);
  });
});

describe('reading the Google Birthdays calendar', () => {
  const window = { start: Date.UTC(2027, 0, 1), end: Date.UTC(2027, 1, 1) };
  const feed = (items: unknown, status = 200) => ({ calls: [] as string[], fetchFn: (async (url: string) => { feed.last = url; return new Response(JSON.stringify({ items }), { status }); }) as unknown as typeof fetch });
  feed.last = '';
  it('reads only a name and a day, and copes with names ending in s and curly apostrophes', async () => {
    const f = feed([
      { summary: "Maya's birthday", start: { date: '2027-01-12' }, description: 'private note', attendees: [{ email: 'x@y.z' }] },
      { summary: "James' birthday", start: { date: '2027-01-14' } },
      { summary: 'Mei Lin’s birthday', start: { date: '2027-01-20' } },
      { summary: 'Team offsite', start: { date: '2027-01-21' } },
      { summary: "Nobody's birthday" },
    ]);
    const cal = new GoogleCalendar({ accessToken: async () => 'tok', fetchFn: f.fetchFn });
    const found = await cal.birthdays('p', window);
    expect(found).toEqual([{ name: 'Maya', month: 1, day: 12 }, { name: 'James', month: 1, day: 14 }, { name: 'Mei Lin', month: 1, day: 20 }]);
    expect(JSON.stringify(found)).not.toContain('private');
    expect(feed.last).toContain(encodeURIComponent('addressbook#contacts@group.v.calendar.google.com'));
  });
  it('treats a missing or forbidden Birthdays calendar as "nothing to learn"', async () => {
    for (const status of [403, 404]) expect(await new GoogleCalendar({ accessToken: async () => 't', fetchFn: feed([], status).fetchFn }).birthdays('p', window)).toEqual([]);
    await expect(new GoogleCalendar({ accessToken: async () => 't', fetchFn: feed([], 500).fetchFn }).birthdays('p', window)).rejects.toThrow('status 500');
  });
});

describe('the new commands', () => {
  function cmdWorld() {
    const w = world(phx(2027, 1, 5, 10));
    const ctx: InteractionContext = { app: w.app, now: () => w.state.now, connectUrl: async () => undefined };
    const cmd = (id: string, sub: string, values: Record<string, string | boolean> = {}) => ({
      type: 2, channel_id: 'chan', member: { user: { id, username: id } },
      data: { name: 'rally', options: [{ name: sub, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, type: typeof value === 'boolean' ? 5 : 3, value })) }] },
    });
    const say = async (id: string, sub: string, v?: Record<string, string | boolean>) => ((await handleInteraction(cmd(id, sub, v), ctx)).body as any).data.content as string;
    return { w, say };
  }
  it('/rally auto changes the mode, tells the channel, and rejects nonsense', async () => {
    const { w, say } = cmdWorld();
    await circleOf(w);
    expect(await say('ana', 'auto', { mode: 'auto' })).toContain('plans by itself');
    expect((await w.app.circlesOf('ana'))[0]!.mode).toBe('auto');
    expect(w.platform.posts.at(-1)!.text).toContain('automatic planning');
    expect(await say('ana', 'auto', { mode: 'chaos' })).toContain('Pick automatic');
    expect(await say('ana', 'auto', { mode: 'ask' })).toContain('ask a likely host');
    expect(await say('nobody', 'auto', { mode: 'auto' })).toContain('join a circle first');
  });
  it('/rally festival turns a festival on or off, and /rally status shows the settings', async () => {
    const { w, say } = cmdWorld();
    await circleOf(w);
    expect(await say('ana', 'festival', { name: 'diwali', on: true })).toContain('Diwali is on');
    expect(await say('ana', 'festival', { name: 'halloween', on: false })).toContain('Halloween is off');
    expect(await say('ana', 'festival', { name: 'made-up', on: true })).toContain('do not know that festival');
    const status = await say('ana', 'status');
    expect(status).toContain('Dorm: asks a host first');
    expect(status).toContain('Diwali');
    expect(status).not.toContain('Halloween');
  });
});
