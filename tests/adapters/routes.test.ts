import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as discord } from '../../app/api/discord/route';
import { POST as tick } from '../../app/api/tick/route';
import { GET as callback } from '../../app/api/google/callback/route';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const der = publicKey.export({ type: 'spki', format: 'der' });
const KEY_HEX = der.subarray(der.length - 32).toString('hex');

const ENV = {
  DISCORD_APP_ID: '1', DISCORD_PUBLIC_KEY: KEY_HEX, DISCORD_BOT_TOKEN: 'bot', SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', APP_URL: 'https://rally.example', CRON_SECRET: 'cron-secret-123',
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const signed = (body: string, ts = '1700000000') =>
  new Request('https://rally.example/api/discord', {
    method: 'POST',
    body,
    headers: { 'x-signature-ed25519': sign(null, Buffer.from(ts + body), privateKey).toString('hex'), 'x-signature-timestamp': ts },
  });

describe('POST /api/discord', () => {
  it('answers a correctly signed ping', async () => {
    const res = await discord(signed('{"type":1}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });
  it('rejects a missing, wrong or replayed-on-another-body signature with 401', async () => {
    expect((await discord(new Request('https://x/api/discord', { method: 'POST', body: '{"type":1}' }))).status).toBe(401);
    const good = signed('{"type":1}');
    const forged = new Request('https://x/api/discord', { method: 'POST', body: '{"type":2}', headers: good.headers });
    expect((await discord(forged)).status).toBe(401);
  });
  it('rejects a signed body that is not JSON', async () => {
    expect((await discord(signed('not json'))).status).toBe(400);
  });
  it('reports missing configuration by name, never by value', async () => {
    delete process.env.SUPABASE_URL;
    const res = await discord(signed('{"type":1}'));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('SUPABASE_URL');
    expect(text).not.toContain('svc');
  });
});

describe('POST /api/tick', () => {
  it('refuses without the cron secret', async () => {
    expect((await tick(new Request('https://x/api/tick', { method: 'POST' }))).status).toBe(403);
    expect((await tick(new Request('https://x/api/tick', { method: 'POST', headers: { 'x-cron-secret': 'wrong-secret-12' } }))).status).toBe(403);
  });
});

describe('GET /api/google/callback', () => {
  it('rejects a link with no code or a malformed state', async () => {
    expect((await callback(new Request('https://x/api/google/callback'))).status).toBe(400);
    expect((await callback(new Request('https://x/api/google/callback?code=abc&state=nodot'))).status).toBe(400);
  });
});
