import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DemoCalendar } from '../../src/adapters/calendar/demo';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { handleDiscordRequest } from '../../src/app/discordRoute';
import { editOriginal, toFollowUp } from '../../src/app/followup';
import { Orchestrator } from '../../src/app/orchestrator';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const der = publicKey.export({ type: 'spki', format: 'der' });
const KEY = der.subarray(der.length - 32).toString('hex');

function world(overrides: { failApp?: boolean } = {}) {
  const store = new MemoryStore();
  const platform = new FakePlatform();
  const app = new Orchestrator({ store, calendar: new DemoCalendar(store), platform, now: () => Date.UTC(2026, 9, 26, 17) });
  if (overrides.failApp) app.ensurePerson = async () => { throw new Error('database is down'); };
  const deferred: (() => Promise<void>)[] = [];
  const calls: { url: string; body: any }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  const deps = {
    runtime: () => ({ env: { DISCORD_PUBLIC_KEY: KEY, DISCORD_APP_ID: 'APP1' }, ctx: { app, now: () => Date.UTC(2026, 9, 26, 17), connectUrl: async () => undefined } }),
    defer: (work: () => Promise<void>) => { deferred.push(work); },
    fetchFn,
  };
  const run = async () => { for (const w of deferred.splice(0)) await w(); };
  return { deps, run, calls, deferred, app };
}

const signed = (payload: unknown) => {
  const body = JSON.stringify(payload);
  const ts = '1700000000';
  return new Request('https://x/api/discord', { method: 'POST', body, headers: { 'x-signature-ed25519': sign(null, Buffer.from(ts + body), privateKey).toString('hex'), 'x-signature-timestamp': ts } });
};
const command = (sub: string, values: Record<string, string> = {}) => ({
  type: 2, token: 'TOKEN123', channel_id: 'chan', member: { user: { id: 'u1', username: 'sid' } },
  data: { name: 'rally', options: [{ name: sub, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, type: 3, value })) }] },
});

describe('answering inside Discord\'s 3 seconds', () => {
  it('replies "thinking" at once for a command, then fills in the real answer', async () => {
    const w = world();
    const res = await handleDiscordRequest(signed(command('newcircle', { name: 'Dorm' })), w.deps);
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(w.calls).toEqual([]); // nothing slow has happened yet
    expect(w.deferred).toHaveLength(1);
    await w.run();
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]!.url).toBe('https://discord.com/api/v10/webhooks/APP1/TOKEN123/messages/@original');
    expect(w.calls[0]!.body.content).toContain('Dorm is ready');
  });

  it('defers a button press as an update, and clears the buttons when done', async () => {
    const w = world();
    const res = await handleDiscordRequest(signed({ type: 3, token: 'TOKEN123', member: { user: { id: 'u1', username: 'sid' } }, message: { content: 'Old text' }, data: { custom_id: 'party:none:rsvp_yes' } }), w.deps);
    expect(await res.json()).toEqual({ type: 6 });
    await w.run();
    expect(w.calls[0]!.body.content).toContain('Old text');
    expect(w.calls[0]!.body.content).toContain('That plan is not yours');
    expect(w.calls[0]!.body.components).toEqual([]);
  });

  it('still tells the student something if the work fails', async () => {
    const w = world({ failApp: true });
    await handleDiscordRequest(signed(command('status')), w.deps);
    await w.run();
    expect(w.calls[0]!.body.content).toContain('Something went wrong on my side');
    expect(JSON.stringify(w.calls)).not.toContain('database is down');
  });

  it('answers a ping immediately, with nothing deferred', async () => {
    const w = world();
    const res = await handleDiscordRequest(signed({ type: 1 }), w.deps);
    expect(await res.json()).toEqual({ type: 1 });
    expect(w.deferred).toEqual([]);
  });

  it('rejects a bad signature before doing any work', async () => {
    const w = world();
    const good = signed(command('status'));
    const forged = new Request('https://x', { method: 'POST', body: JSON.stringify(command('newcircle', { name: 'x' })), headers: good.headers });
    expect((await handleDiscordRequest(forged, w.deps)).status).toBe(401);
    expect(w.deferred).toEqual([]);
  });

  it('survives the follow-up call failing', async () => {
    const w = world();
    w.deps.fetchFn = (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch;
    await handleDiscordRequest(signed(command('status')), w.deps);
    await expect(w.run()).resolves.toBeUndefined();
  });
});

describe('follow-up helpers', () => {
  it('edits the original message without exposing the token on failure', async () => {
    const fetchFn = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    const err = await editOriginal('APP', 'SECRET_TOKEN', { content: 'hi' }, fetchFn).catch((e: Error) => e);
    expect((err as Error).message).toContain('401');
    expect((err as Error).message).not.toContain('SECRET_TOKEN');
  });
  it('trims a long reply to fit Discord when sending, and fills in an empty one', async () => {
    let sent = '';
    const fetchFn = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)).content; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await editOriginal('APP', 'T', { content: 'x'.repeat(5000) }, fetchFn);
    expect(sent.length).toBeLessThanOrEqual(2000);
    expect(toFollowUp({ type: 4, data: {} }).content).toBe('Done.');
    expect(toFollowUp(undefined).content).toBe('Done.');
  });
});
