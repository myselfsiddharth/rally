import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GoogleCalendar } from '../../src/adapters/calendar/google';
import { GoogleOAuth } from '../../src/adapters/calendar/oauth';
import { RALLY_COMMAND } from '../../src/adapters/platform/commands';
import { DiscordPlatform, verifyDiscordSignature } from '../../src/adapters/platform/discord';
import { FakeCalendar } from '../../src/adapters/calendar/fake';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { SupabaseStore } from '../../src/adapters/store/supabase';
import { handleInteraction, type InteractionContext } from '../../src/app/interactions';
import { Orchestrator } from '../../src/app/orchestrator';
import { PrivateCalendar } from '../../src/engine/protocol';
import { CalendarError } from '../../src/adapters/calendar/port';

type Call = { url: string; init: RequestInit };
const recorder = (responses: Array<Response | (() => Response)>) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Discord signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const keyHex = der.subarray(der.length - 32).toString('hex');
  const body = '{"type":1}';
  const ts = '1700000000';
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString('hex');
  it('accepts a genuine request', () => expect(verifyDiscordSignature(keyHex, sig, ts, body)).toBe(true));
  it('rejects a tampered body, timestamp or signature', () => {
    expect(verifyDiscordSignature(keyHex, sig, ts, '{"type":2}')).toBe(false);
    expect(verifyDiscordSignature(keyHex, sig, '1700000001', body)).toBe(false);
    expect(verifyDiscordSignature(keyHex, sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), ts, body)).toBe(false);
  });
  it('rejects malformed keys and signatures without throwing', () => {
    expect(verifyDiscordSignature('zz', sig, ts, body)).toBe(false);
    expect(verifyDiscordSignature(keyHex, 'short', ts, body)).toBe(false);
    expect(verifyDiscordSignature(keyHex, '', '', '')).toBe(false);
  });
});

describe('slash command spec', () => {
  it('fits Discord limits', () => {
    expect(RALLY_COMMAND.name).toBe('rally');
    const subs = RALLY_COMMAND.options;
    expect(subs.length).toBeLessThanOrEqual(25);
    for (const s of subs) {
      expect(s.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(s.description.length).toBeLessThanOrEqual(100);
      for (const o of (s as { options?: { name: string; description: string }[] }).options ?? []) {
        expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
        expect(o.description.length).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('Google Calendar adapter', () => {
  const window = { start: Date.UTC(2026, 9, 26), end: Date.UTC(2026, 9, 27) };
  it('asks for free/busy and parses the answer', async () => {
    const { calls, fetchFn } = recorder([json({ calendars: { primary: { busy: [{ start: '2026-10-26T10:00:00Z', end: '2026-10-26T11:00:00Z' }] } } })]);
    const cal = new GoogleCalendar({ accessToken: async () => 'tok', fetchFn });
    expect(await cal.busy('p', window)).toEqual([{ start: Date.UTC(2026, 9, 26, 10), end: Date.UTC(2026, 9, 26, 11) }]);
    expect(calls[0]!.url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ timeMin: '2026-10-26T00:00:00.000Z', items: [{ id: 'primary' }] });
  });
  it('inserts an event with a plain title and times', async () => {
    const { calls, fetchFn } = recorder([json({ id: 'ev1' })]);
    const cal = new GoogleCalendar({ accessToken: async () => 'tok', fetchFn });
    expect(await cal.insertEvent('p', { title: "Fay's birthday", interval: window })).toEqual({ id: 'ev1' });
    expect(calls[0]!.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ summary: "Fay's birthday", start: { dateTime: '2026-10-26T00:00:00.000Z' } });
  });
  it('rejects malformed and failing responses without leaking the token', async () => {
    const bad = recorder([json({ nope: 1 }), json({}, 500)]);
    const cal = new GoogleCalendar({ accessToken: async () => 'SECRET_TOKEN', fetchFn: bad.fetchFn });
    await expect(cal.busy('p', window)).rejects.toThrow('unexpected response');
    const err = await cal.busy('p', window).catch((e: Error) => e);
    expect(err).toBeInstanceOf(CalendarError);
    expect((err as Error).message).not.toContain('SECRET_TOKEN');
  });
  it('says not connected when there is no token', async () => {
    const cal = new GoogleCalendar({ accessToken: async () => undefined });
    expect(await cal.connected('p')).toBe(false);
    await expect(cal.busy('p', window)).rejects.toThrow('not connected');
  });
});

describe('Google OAuth', () => {
  const cfg = { clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://app.example/api/google/callback' };
  it('builds a consent link that asks only for free/busy and event access', () => {
    const url = new URL(new GoogleOAuth(cfg, new MemoryStore()).authUrl('p1', 's3cret'));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('p1.s3cret');
  });
  it('stores a refresh token, reuses a fresh access token and refreshes an expired one', async () => {
    let t = 1_000_000;
    const store = new MemoryStore();
    const { calls, fetchFn } = recorder([json({ access_token: 'a1', expires_in: 3600, refresh_token: 'r1' }), json({ access_token: 'a2', expires_in: 3600 })]);
    const oauth = new GoogleOAuth({ ...cfg, fetchFn, now: () => t }, store);
    await oauth.exchange('p1', 'code123');
    expect(String(calls[0]!.init.body)).toContain('grant_type=authorization_code');
    expect(await oauth.accessToken('p1')).toBe('a1');
    expect(calls).toHaveLength(1);
    t += 3_600_000;
    expect(await oauth.accessToken('p1')).toBe('a2');
    expect(String(calls[1]!.init.body)).toContain('refresh_token=r1');
    expect(await oauth.accessToken('nobody')).toBeUndefined();
    await oauth.disconnect('p1');
    expect(await oauth.accessToken('p1')).toBeUndefined();
  });
  it('fails clearly when Google gives no refresh token', async () => {
    const { fetchFn } = recorder([json({ access_token: 'a', expires_in: 10 })]);
    await expect(new GoogleOAuth({ ...cfg, fetchFn }, new MemoryStore()).exchange('p', 'c')).rejects.toThrow('refresh token');
  });
});

describe('Supabase store', () => {
  it('reads, upserts, lists and deletes through the REST interface', async () => {
    const { calls, fetchFn } = recorder([json([{ key: 'k', value: { n: 1 } }]), new Response(null, { status: 201 }), json([{ key: 'a', value: 1 }, { key: 'b', value: 2 }]), new Response(null, { status: 204 })]);
    const s = new SupabaseStore('https://x.supabase.co/', 'svc', fetchFn);
    expect(await s.get('party', 'k')).toEqual({ n: 1 });
    await s.put('party', 'k', { n: 2 });
    expect(await s.list('party')).toEqual([1, 2]);
    await s.del('party', 'k');
    expect(calls[0]!.url).toBe('https://x.supabase.co/rest/v1/rally_kv?ns=eq.party&key=eq.k&select=key,value');
    expect(calls[1]!.url).toContain('on_conflict=ns,key');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ ns: 'party', key: 'k', value: { n: 2 } });
    expect(calls[3]!.init.method).toBe('DELETE');
    expect(new Headers(calls[0]!.init.headers).get('apikey')).toBe('svc');
  });
  it('returns undefined for a missing key and throws without leaking the key on failure', async () => {
    const { fetchFn } = recorder([json([]), json({}, 401)]);
    const s = new SupabaseStore('https://x.supabase.co', 'SERVICE_KEY_VALUE', fetchFn);
    expect(await s.get('a', 'b')).toBeUndefined();
    const err = await s.get('a', 'b').catch((e: Error) => e);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('SERVICE_KEY_VALUE');
  });
});

describe('Discord platform', () => {
  it('opens a DM channel once, then sends text and buttons', async () => {
    const { calls, fetchFn } = recorder([json({ id: 'chan9' }), json({}), json({})]);
    const p = new DiscordPlatform({ botToken: 'bot', channelOf: async () => undefined, fetchFn });
    await p.dm('u1', 'hello', [{ id: 'party:1:rsvp_yes', label: "I'm in", style: 'primary' }]);
    await p.dm('u1', 'again');
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/users/@me/channels');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ recipient_id: 'u1' });
    expect(calls[1]!.url).toBe('https://discord.com/api/v10/channels/chan9/messages');
    expect(JSON.parse(String(calls[1]!.init.body)).components[0].components[0]).toMatchObject({ type: 2, style: 1, custom_id: 'party:1:rsvp_yes' });
    expect(calls).toHaveLength(3);
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bot bot');
  });
  it('posts to the circle channel, and reports failures without the token', async () => {
    const ok = recorder([json({})]);
    await new DiscordPlatform({ botToken: 'bot', channelOf: async () => 'ch1', fetchFn: ok.fetchFn }).post('c1', 'hi');
    expect(ok.calls[0]!.url).toBe('https://discord.com/api/v10/channels/ch1/messages');
    const bad = recorder([json({}, 403)]);
    const err = await new DiscordPlatform({ botToken: 'TOPSECRET', channelOf: async () => 'ch1', fetchFn: bad.fetchFn }).post('c1', 'hi').catch((e: Error) => e);
    expect((err as Error).message).toContain('403');
    expect((err as Error).message).not.toContain('TOPSECRET');
  });
});

describe('interaction handler', () => {
  const phx = (m: number, d: number, h: number) => Date.UTC(2026, m - 1, d, h + 7);
  function world() {
    const store = new MemoryStore();
    const calendars = Object.fromEntries(['u1', 'u2', 'u3', 'u4'].map((id) => [id, new PrivateCalendar([])]));
    const platform = new FakePlatform();
    const clock = { now: phx(10, 26, 10) };
    const app = new Orchestrator({ store, calendar: new FakeCalendar(calendars), platform, now: () => clock.now });
    const ctx: InteractionContext = { app, now: () => clock.now, connectUrl: async (p) => `https://accounts.example/auth?u=${p}` };
    return { ctx, app, platform, store };
  }
  const user = (id: string) => ({ user: { id, username: `name-${id}` } });
  const cmd = (id: string, sub: string, values: Record<string, string | number | boolean> = {}, channel = 'chan1') => ({
    type: 2,
    channel_id: channel,
    member: user(id),
    data: { name: 'rally', options: [{ name: sub, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, type: typeof value === 'number' ? 4 : typeof value === 'boolean' ? 5 : 3, value })) }] },
  });
  const text = (r: { body: any }) => r.body.data.content as string;

  it('answers a ping and rejects junk', async () => {
    const { ctx } = world();
    expect(await handleInteraction({ type: 1 }, ctx)).toEqual({ status: 200, body: { type: 1 } });
    expect((await handleInteraction({ nope: true }, ctx)).status).toBe(400);
    expect(text(await handleInteraction({ type: 2, data: { name: 'rally' } }, ctx))).toContain('could not tell who');
  });

  it('creates a circle, lets friends join, and plans a party, refusing a second one within 14 days', async () => {
    const { ctx, platform } = world();
    const made = text(await handleInteraction(cmd('u1', 'newcircle', { name: 'Dorm 4' }), ctx));
    const code = made.match(/rally join (\w+)/)![1]!;
    for (const id of ['u2', 'u3', 'u4']) expect(text(await handleInteraction(cmd(id, 'join', { code }, 'x'), ctx))).toContain('You are in Dorm 4');
    const started = await handleInteraction(cmd('u1', 'plan', { occasion: 'hangout' }), ctx);
    expect(text(started)).toContain('checking everyone');
    expect(platform.to('u2').length).toBeGreaterThan(0);
    const second = await handleInteraction(cmd('u2', 'plan', { occasion: 'hangout' }, 'chan1'), ctx);
    expect(text(second)).toContain('14 days');
  });

  it('handles prefs, skip, birthday, status, pause and forget', async () => {
    const { ctx, app } = world();
    expect(text(await handleInteraction(cmd('u1', 'prefs', { quiet_from: 23, car: true, coffee_per_week: 9 }), ctx))).toContain('Saved');
    const rec = (await app.person('u1'))!;
    expect(rec.prefs).toMatchObject({ quietStartHour: 23, hasCar: true, maxPairInvitesPerWeek: 3 });
    expect(text(await handleInteraction(cmd('u1', 'prefs'), ctx))).toContain('Nothing to change');
    await handleInteraction(cmd('u1', 'skip', { person: 'u2' }), ctx);
    expect((await app.person('u1'))!.prefs.neverSuggest).toEqual(['u2']);
    expect(text(await handleInteraction(cmd('u1', 'birthday', { month: 11, day: 2 }), ctx))).toContain('Got it');
    expect(text(await handleInteraction(cmd('u1', 'birthday', { month: 2, day: 31 }), ctx))).toContain('Got it'); // lenient on day, strict on month range
    expect(text(await handleInteraction(cmd('u1', 'status'), ctx))).toContain('Calendar: connected');
    await handleInteraction(cmd('u1', 'pause', { on: true }), ctx);
    expect((await app.person('u1'))!.paused).toBe(true);
    expect(text(await handleInteraction(cmd('u1', 'connect'), ctx))).toContain('https://accounts.example/auth?u=u1');
    await handleInteraction(cmd('u1', 'forget'), ctx);
    expect(await app.person('u1')).toBeUndefined();
  });

  it('turns a button press into an update that removes the buttons', async () => {
    const { ctx, platform } = world();
    const made = text(await handleInteraction(cmd('u1', 'newcircle', { name: 'Dorm' }), ctx));
    const code = made.match(/rally join (\w+)/)![1]!;
    for (const id of ['u2', 'u3']) await handleInteraction(cmd(id, 'join', { code }, 'x'), ctx);
    await handleInteraction(cmd('u1', 'plan', { occasion: 'hangout' }), ctx);
    const dm = platform.to('u2').find((d) => d.buttons.length)!;
    const res = await handleInteraction({ type: 3, member: user('u2'), message: { content: dm.text }, data: { custom_id: dm.buttons[0]!.id } }, ctx);
    expect((res.body as any).type).toBe(7);
    expect((res.body as any).data.components).toEqual([]);
    expect((res.body as any).data.content).toContain(dm.text);
  });

  it('rejects a bad plan request politely', async () => {
    const { ctx } = world();
    await handleInteraction(cmd('u1', 'newcircle', { name: 'Dorm' }), ctx);
    expect(text(await handleInteraction(cmd('u1', 'plan', { occasion: 'birthday' }), ctx))).toContain('whose birthday');
    expect(text(await handleInteraction(cmd('u1', 'plan', { occasion: 'nonsense' }), ctx))).toContain('Pick birthday');
    expect(text(await handleInteraction(cmd('u9', 'plan', { occasion: 'hangout' }, 'elsewhere'), ctx))).toContain('join a circle');
  });
});

import { DemoCalendar } from '../../src/adapters/calendar/demo';
import { readEnv } from '../../src/lib/env';
import { DAY, HOUR as H, intersect } from '../../src/engine/time';

describe('DemoCalendar', () => {
  const window = { start: Date.UTC(2026, 9, 26, 7), end: Date.UTC(2026, 9, 26, 7) + 7 * DAY };
  it('gives each person the same believable week every time, and different people different weeks', async () => {
    const cal = new DemoCalendar(new MemoryStore());
    const a1 = await cal.busy('alice', window);
    expect(await cal.busy('alice', window)).toEqual(a1);
    expect(a1.length).toBeGreaterThan(5);
    expect(await cal.busy('bob', window)).not.toEqual(a1);
    // looking at a later window gives exactly the overlapping part of what the earlier window showed
    const later = { start: window.start + 2 * DAY, end: window.end };
    expect(await cal.busy('alice', later)).toEqual(intersect(a1, [later]));
  });
  it('remembers events the agents add, through the store, and says it is a demo', async () => {
    const store = new MemoryStore();
    const cal = new DemoCalendar(store);
    const slot = { start: window.start + 5 * H, end: window.start + 6 * H };
    await cal.insertEvent('alice', { title: 'Coffee with Bob', interval: slot });
    expect((await new DemoCalendar(store).busy('alice', window)).some((i) => i.start <= slot.start && i.end >= slot.end)).toBe(true);
    expect(cal.isDemo).toBe(true);
    expect(await cal.connected()).toBe(true);
  });
});

describe('environment without Google', () => {
  const base = {
    DISCORD_APP_ID: '1', DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 't', SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k', APP_URL: 'https://rally.example', CRON_SECRET: '12345678',
  };
  it('is valid: Google is optional and the demo calendar takes over', () => {
    expect(readEnv(base).GOOGLE_CLIENT_ID).toBeUndefined();
  });
  it('still rejects a bad calendar mode', () => {
    expect(() => readEnv({ ...base, CALENDAR_MODE: 'nope' })).toThrow('CALENDAR_MODE');
  });
});

import { HybridCalendar } from '../../src/adapters/calendar/hybrid';

describe('HybridCalendar', () => {
  const window = { start: Date.UTC(2026, 9, 26, 7), end: Date.UTC(2026, 9, 27, 7) };
  it('uses Google for people who connected and a demo calendar for everyone else, and reports which', async () => {
    const calls: string[] = [];
    const google = {
      connected: async (p: string) => p === 'real',
      busy: async (p: string) => { calls.push(`google:${p}`); return [{ start: window.start, end: window.start + 3_600_000 }]; },
      insertEvent: async (p: string) => { calls.push(`google-insert:${p}`); return { id: 'g' }; },
    };
    const hybrid = new HybridCalendar(google, new DemoCalendar(new MemoryStore()));
    expect(await hybrid.kind('real')).toBe('connected');
    expect(await hybrid.kind('guest')).toBe('demo');
    expect(await hybrid.connected()).toBe(true);
    expect(await hybrid.busy('real', window)).toEqual([{ start: window.start, end: window.start + 3_600_000 }]);
    await hybrid.busy('guest', window);
    await hybrid.insertEvent('real', { title: 't', interval: window });
    await hybrid.insertEvent('guest', { title: 't', interval: window });
    expect(calls).toEqual(['google:real', 'google-insert:real']);
  });
});
