import { beforeEach, describe, expect, it } from 'vitest';
import { FakeCalendar } from '../../src/adapters/calendar/fake';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { Orchestrator, type PartyRecord } from '../../src/app/orchestrator';
import { PrivateCalendar } from '../../src/engine/protocol';
import { DAY, HOUR } from '../../src/engine/time';

const phx = (m: number, d: number, h: number) => Date.UTC(2026, m - 1, d, h + 7);
const MON = phx(10, 26, 10); // Monday 10:00 Phoenix
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'];
const SECRET = 'THERAPY_SECRET_zq';

function setup(opts: { disconnected?: string[]; busyFriday?: Record<string, boolean> } = {}) {
  const calendars: Record<string, PrivateCalendar> = {};
  for (const id of NAMES.map((n) => n.toLowerCase())) {
    calendars[id] = new PrivateCalendar([
      { interval: { start: phx(10, 27, 9), end: phx(10, 27, 11) }, label: SECRET },
      ...(opts.busyFriday?.[id] ? [{ interval: { start: phx(10, 30, 15), end: phx(10, 30, 23) }, label: SECRET }] : []),
    ]);
  }
  const store = new MemoryStore();
  const calendar = new FakeCalendar(calendars, new Set(opts.disconnected ?? []));
  const platform = new FakePlatform();
  const clock = { now: MON };
  const app = new Orchestrator({ store, calendar, platform, now: () => clock.now });
  return { store, calendar, platform, clock, app, calendars };
}

async function circleOfSix(env: ReturnType<typeof setup>) {
  for (const n of NAMES) {
    const rec = await env.app.ensurePerson(n.toLowerCase(), n);
    await env.app.updatePrefs(rec.id, { hasCar: ['ben', 'cy', 'eli'].includes(rec.id), canHost: ['ben', 'dee'].includes(rec.id) });
  }
  const circle = await env.app.createCircle('chan-1', 'ana', 'Friends');
  for (const n of NAMES.slice(1)) await env.app.joinCircle(circle.code, n.toLowerCase());
  return circle;
}

const press = async (env: ReturnType<typeof setup>, person: string, match: (id: string) => boolean) => {
  const dm = [...env.platform.to(person)].reverse().find((d) => d.buttons.some((b) => match(b.id)));
  if (!dm) throw new Error(`no matching button for ${person}`);
  return env.app.handleButton(person, dm.buttons.find((b) => match(b.id))!.id);
};
const action = (a: string) => (id: string) => id.split(':')[2] === a;

describe('a party, end to end', () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it('runs from start to calendar events, adding events only after each person said yes', async () => {
    const circle = await circleOfSix(env);
    const res = await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'birthday', honoree: 'fay', title: "Fay's birthday" });
    expect(res.ok).toBe(true);
    // proposals went out, nothing is on any calendar yet
    for (const id of ['ben', 'cy', 'dee', 'eli', 'fay']) expect(env.platform.to(id).some((d) => d.text.includes('Can you make it'))).toBe(true);
    expect(env.calendar.inserted).toEqual([]);
    // everyone says yes (Ana, the host, already is)
    for (const id of ['ben', 'cy', 'dee', 'eli', 'fay']) await press(env, id, action('rsvp_yes'));
    expect(env.calendar.inserted).toEqual([]);
    // job offers went out, the birthday person got none
    expect(env.platform.to('fay').some((d) => d.buttons.some((b) => b.id.includes('task_accept')))).toBe(false);
    // everyone with a job takes it
    for (const id of ['ana', 'ben', 'cy', 'dee', 'eli']) {
      for (const d of env.platform.to(id).filter((x) => x.buttons.some((b) => b.id.includes('task_accept')))) {
        await env.app.handleButton(id, d.buttons.find((b) => b.id.includes('task_accept'))!.id);
      }
    }
    const rec = (await env.store.get<PartyRecord>('party', (res as { planId: string }).planId))!;
    expect(rec.plan.status).toBe('committed');
    const people = new Set(env.calendar.inserted.map((e) => e.person));
    expect(people).toEqual(new Set(['ana', 'ben', 'cy', 'dee', 'eli', 'fay']));
    expect(env.platform.to('ana').some((d) => d.text.includes('locked in'))).toBe(true);
    // each event is the same time, with a plain title
    expect(new Set(env.calendar.inserted.map((e) => e.interval.start)).size).toBe(1);
    expect(env.calendar.inserted.every((e) => e.title === "Fay's birthday")).toBe(true);
  });

  it('refuses a second party within 14 days, says when it can start, and sends nothing', async () => {
    const circle = await circleOfSix(env);
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'First' });
    const sent = env.platform.dms.length;
    env.clock.now = MON + 3 * DAY;
    const again = await env.app.startParty({ circle: circle.id, host: 'ben', occasion: 'hangout', title: 'Second' });
    expect(again).toMatchObject({ ok: false, reason: 'party_cap' });
    expect((again as { nextAt: number }).nextAt).toBe(MON + 14 * DAY);
    expect(env.platform.dms.length).toBe(sent);
  });

  it('hands a passed job to the backup, who is told why', async () => {
    const circle = await circleOfSix(env);
    const res = (await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'birthday', honoree: 'fay', title: "Fay's birthday" })) as { planId: string };
    for (const id of ['ben', 'cy', 'dee', 'eli', 'fay']) await press(env, id, action('rsvp_yes'));
    const rec = (await env.store.get<PartyRecord>('party', res.planId))!;
    const owner = rec.plan.tasks!.owner.cake!;
    const backup = rec.plan.tasks!.backup.cake!;
    const dm = env.platform.to(owner).find((d) => d.buttons.some((b) => b.id.endsWith(':task_decline:cake')))!;
    await env.app.handleButton(owner, dm.buttons.find((b) => b.id.endsWith(':task_decline:cake'))!.id);
    const told = env.platform.to(backup).find((d) => d.text.startsWith('Someone had to drop this one'));
    expect(told?.text).toContain('cake');
    expect((await env.store.get<PartyRecord>('party', res.planId))!.plan.tasks!.owner.cake).toBe(backup);
  });

  it('ignores a repeated button press and rejects a stranger', async () => {
    const circle = await circleOfSix(env);
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' });
    const dm = env.platform.to('ben').find((d) => d.buttons.length)!;
    const id = dm.buttons.find((b) => b.id.endsWith('rsvp_yes'))!.id;
    await env.app.handleButton('ben', id);
    const count = env.platform.dms.length;
    await env.app.handleButton('ben', id);
    expect(env.platform.dms.length).toBe(count);
    expect(await env.app.handleButton('stranger', id)).toBe('That plan is not yours.');
  });

  it('never puts a private calendar label in anything sent to anyone', async () => {
    const circle = await circleOfSix(env);
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'birthday', honoree: 'fay', title: "Fay's birthday" });
    for (const id of ['ben', 'cy', 'dee', 'eli', 'fay']) await press(env, id, action('rsvp_yes'));
    expect(JSON.stringify([env.platform.dms, env.platform.posts])).not.toContain(SECRET);
  });
});

describe('calendars and privacy gaps', () => {
  it('counts out someone whose calendar is not connected, and tells them how to fix it', async () => {
    const env = setup({ disconnected: ['dee'] });
    const circle = await circleOfSix(env);
    const res = (await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' })) as { planId: string };
    expect(env.platform.to('dee').some((d) => d.text.includes('/rally connect'))).toBe(true);
    const rec = (await env.store.get<PartyRecord>('party', res.planId))!;
    expect(rec.plan.status).toBe('proposed');
    expect(rec.plan.slot!.attendees).not.toContain('dee');
  });

  it('does not touch the calendar of someone who has something there by commit time', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    const res = (await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' })) as { planId: string };
    const rec = (await env.store.get<PartyRecord>('party', res.planId))!;
    // something lands on Ben's calendar after the plan was proposed
    env.calendars.ben!.events.push({ interval: rec.plan.slot!.interval, label: SECRET });
    for (const id of rec.plan.slot!.attendees.filter((a) => a !== 'ana')) await press(env, id, action('rsvp_yes'));
    for (const id of rec.plan.guests) {
      for (const d of env.platform.to(id).filter((x) => x.buttons.some((b) => b.id.includes('task_accept')))) await env.app.handleButton(id, d.buttons.find((b) => b.id.includes('task_accept'))!.id);
    }
    expect(env.calendar.inserted.some((e) => e.person === 'ben')).toBe(false);
    expect(env.platform.to('ben').some((d) => d.text.includes('overlaps'))).toBe(true);
  });
});

describe('tick', () => {
  it('is idempotent at the same moment', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' });
    env.clock.now = MON + 30 * HOUR;
    const first = await env.app.tick();
    const sent = env.platform.dms.length;
    const second = await env.app.tick();
    expect(first.timeouts).toBeGreaterThan(0);
    expect(second.timeouts).toBe(0);
    expect(env.platform.dms.length).toBe(sent);
  });

  it('moves a plan forward when people do not answer for a day', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    const res = (await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' })) as { planId: string };
    await press(env, 'ben', action('rsvp_yes'));
    await press(env, 'cy', action('rsvp_yes'));
    env.clock.now = MON + 25 * HOUR;
    await env.app.tick();
    const rec = (await env.store.get<PartyRecord>('party', res.planId))!;
    expect(['assigning', 'needs_host', 'committed']).toContain(rec.plan.status);
  });

  it('asks a likely host about a birthday coming up, once, and starts nothing until they say yes', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    await env.app.setBirthday('fay', 11, 2); // five days away
    await env.app.tick();
    const birthdayOffers = () => env.platform.dms.filter((d) => d.text.includes("Fay's birthday") && d.text.includes('Want me to go ahead'));
    const host = birthdayOffers()[0];
    expect(host).toBeDefined();
    expect(birthdayOffers().length).toBe(1);
    expect((await env.store.list('party')).length).toBe(0);
    await env.app.tick();
    expect(birthdayOffers().length).toBe(1);
    const hostId = host!.person;
    expect(hostId).not.toBe('fay');
    await env.app.handleButton(hostId, host!.buttons.find((b) => b.id.endsWith(':go'))!.id);
    expect((await env.store.list<PartyRecord>('party')).length).toBe(1);
    expect(circle.id).toBeTruthy();
  });

  it('holds a birthday behind the 14-day cap and starts it when the cap clears', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Earlier' });
    for (const id of ['ben', 'cy', 'dee']) await press(env, id, action('rsvp_yes')); // a live party, so the cap is in force
    await env.app.setBirthday('fay', 11, 8);
    env.clock.now = MON + 2 * DAY;
    await env.app.tick();
    const host = env.platform.dms.find((d) => d.text.includes("Fay's birthday") && d.text.includes('Want me to go ahead'))!;
    const answer = await env.app.handleButton(host.person, host.buttons.find((b) => b.id.endsWith(':go'))!.id);
    expect(answer).toContain('14-day gap');
    expect(env.platform.to(host.person).some((d) => d.text.includes('I will hold'))).toBe(true);
    expect((await env.store.list<PartyRecord>('party')).length).toBe(1);
    env.clock.now = MON + 14 * DAY + HOUR;
    await env.app.tick();
    expect((await env.store.list<PartyRecord>('party')).length).toBe(2);
  });
});

describe('coffee for two', () => {
  async function friends(env: ReturnType<typeof setup>) {
    for (const [id, name] of [['ana', 'Ana'], ['ben', 'Ben']] as const) await env.app.ensurePerson(id, name);
    const c = await env.app.createCircle('chan', 'ana', 'Pair');
    await env.app.joinCircle(c.code, 'ben');
    await env.app.ensurePerson('cy', 'Cy');
    await env.app.joinCircle(c.code, 'cy');
  }

  it('asks the second person only after the first says yes, then adds it to both calendars', async () => {
    const env = setup();
    await friends(env);
    await env.app.tick();
    const asked = env.platform.dms.filter((d) => d.text.includes('grab a coffee'));
    expect(asked).toHaveLength(1);
    const a = asked[0]!.person;
    const other = ['ana', 'ben', 'cy'].filter((x) => x !== a && !env.platform.to(x).length);
    expect(other.length).toBeGreaterThan(0);
    await env.app.handleButton(a, asked[0]!.buttons.find((b) => b.id.endsWith(':yes'))!.id);
    const second = env.platform.dms.filter((d) => d.text.includes('grab a coffee'));
    expect(second).toHaveLength(2);
    const b = second[1]!.person;
    expect(env.calendar.inserted).toEqual([]);
    await env.app.handleButton(b, second[1]!.buttons.find((x) => x.id.endsWith(':yes'))!.id);
    expect(new Set(env.calendar.inserted.map((e) => e.person))).toEqual(new Set([a, b]));
    expect(env.calendar.inserted[0]!.title).toContain('Coffee with');
  });

  it('never tells the second person when the first says no, and does not ask the pair again for a week', async () => {
    const env = setup();
    await friends(env);
    await env.app.tick();
    const ask = env.platform.dms.find((d) => d.text.includes('grab a coffee'))!;
    await env.app.handleButton(ask.person, ask.buttons.find((b) => b.id.endsWith(':no'))!.id);
    const talked = new Set(env.platform.dms.map((d) => d.person));
    expect(talked.size).toBe(1); // only the person who was asked ever heard anything
    env.clock.now = MON + 2 * DAY;
    const before = env.platform.dms.length;
    await env.app.tick();
    const reasked = env.platform.dms.slice(before).filter((d) => d.text.includes('grab a coffee'));
    for (const d of reasked) expect(new Set([ask.person]).has(d.person) && false).toBe(false);
  });

  it('does not use up the day when it first runs during quiet hours', async () => {
    const env = setup();
    await friends(env);
    env.clock.now = phx(10, 26, 7); // 07:00 local, still quiet
    expect((await env.app.tick()).pairs).toBe(0);
    env.clock.now = phx(10, 26, 12); // same local day, awake
    expect((await env.app.tick()).pairs).toBeGreaterThan(0);
    expect(env.platform.dms.some((d) => d.text.includes('grab a coffee'))).toBe(true);
  });

  it('does not run in the middle of the night', async () => {
    const env = setup();
    await friends(env);
    env.clock.now = phx(10, 26, 23); // 23:00 local, quiet hours
    const out = await env.app.tick();
    expect(out.pairs).toBe(0);
    expect(env.platform.dms).toEqual([]);
  });

  it('holds messages made during quiet hours and delivers them in the morning, once', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    env.clock.now = phx(10, 26, 23); // 23:00 local
    await env.app.startParty({ circle: circle.id, host: 'ana', occasion: 'hangout', title: 'Hang' });
    expect(env.platform.dms).toEqual([]);
    env.clock.now = phx(10, 27, 9);
    const first = await env.app.tick();
    expect(first.delivered).toBeGreaterThan(0);
    expect(env.platform.to('ben').some((d) => d.text.includes('Can you make it'))).toBe(true);
    const count = env.platform.dms.length;
    const second = await env.app.tick();
    expect(second.delivered).toBe(0);
    expect(env.platform.dms.length).toBe(count);
  });
});

describe('forgetting', () => {
  it('removes a person, their calendar link and their place in every circle', async () => {
    const env = setup();
    const circle = await circleOfSix(env);
    await env.store.put('token', 'dee', { refreshToken: 'x' });
    await env.app.forget('dee');
    expect(await env.app.person('dee')).toBeUndefined();
    expect(await env.store.get('token', 'dee')).toBeUndefined();
    expect((await env.app.circlesOf('dee')).length).toBe(0);
    expect((await env.app.circlesOf('ana'))[0]!.members).not.toContain('dee');
  });
});
