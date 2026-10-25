import { describe, expect, it } from 'vitest';
import { findViolations, passesHardLines, safeLine } from '../../src/lib/filter';
import { LlmUnavailable, NullLlm, OpenAiCompatibleLlm, polish, type Llm } from '../../src/lib/llm';
import { readEnv } from '../../src/lib/env';

describe('hard-line filter', () => {
  const blocked: [string, string][] = [
    ['body', 'Maybe skip the cake, you are getting fat'],
    ['body', 'Count your calories before Friday'],
    ['eating', 'You should purge before the party'],
    ['identity', 'That is so gay'],
    ['health', 'You seem depressed lately'],
    ['health', 'Skip therapy and come out'],
    ['family', 'Ask your mom to pay'],
    ['money', 'Only if you can afford it'],
    ['threat', 'Come or I will kill the plan'],
    ['sexual', 'Bring someone to hook up with, sex later'],
    ['insult', 'You are such a loser'],
    ['link', 'Sign up at https://example.com now'],
  ];
  for (const [cat, line] of blocked) {
    it(`blocks ${cat}: "${line}"`, () => {
      expect(passesHardLines(line)).toBe(false);
      expect(findViolations(line)).toContain(cat);
    });
  }
  it('passes the lines the agents actually say', () => {
    for (const line of [
      "Tariq's birthday is on Sun, Nov 1, 12:00pm to 3:00pm. Can you make it?",
      'Can you bring the cake? Check what everyone can eat before you buy food.',
      "Someone had to drop this one. Can you bring drinks?",
      'You and Maya are both free Thursday at 6pm. Coffee?',
    ]) expect(passesHardLines(line)).toBe(true);
  });
  it('rejects empty and over-long text, and falls back safely', () => {
    expect(passesHardLines('   ')).toBe(false);
    expect(passesHardLines('a'.repeat(400))).toBe(false);
    expect(safeLine('you are fat', 'Can you make it?')).toBe('Can you make it?');
    expect(safeLine('  Sounds fun!  ', 'x')).toBe('Sounds fun!');
  });
});

describe('polish', () => {
  const original = "Tariq's birthday is Sun, Nov 1, 12:00pm to 3:00pm. Can you make it?";
  const say = (s: string): Llm => ({ complete: async () => s });
  it('uses the model line when it keeps every name and time', async () => {
    const warm = "Hey! Tariq's birthday is Sun, Nov 1, 12:00pm to 3:00pm. Can you come?";
    expect(await polish(say(warm), original)).toBe(warm);
  });
  it('falls back when the model drops a time or a name', async () => {
    expect(await polish(say("Tariq's birthday is soon. Can you come?"), original)).toBe(original);
    expect(await polish(say('Birthday party Sun, Nov 1, 12:00pm to 3:00pm, come!'), original)).toBe(original);
  });
  it('falls back when the model says something unsafe', async () => {
    expect(await polish(say("Tariq's birthday is Sun, Nov 1, 12:00pm to 3:00pm. Don't be a loser, come!"), original)).toBe(original);
  });
  it('falls back when there is no model or it fails', async () => {
    expect(await polish(new NullLlm(), original)).toBe(original);
    expect(await polish({ complete: async () => { throw new Error('boom'); } }, original)).toBe(original);
  });
});

describe('OpenAiCompatibleLlm', () => {
  it('sends the right request and reads the reply', async () => {
    let seen: { url: string; body: any; auth: string | null } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') };
      return new Response(JSON.stringify({ choices: [{ message: { content: '  hello  ' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const llm = new OpenAiCompatibleLlm({ baseUrl: 'https://llm.example/v1/', apiKey: 'k', model: 'm', fetchFn });
    expect(await llm.complete('sys', 'user')).toBe('hello');
    expect(seen!.url).toBe('https://llm.example/v1/chat/completions');
    expect(seen!.auth).toBe('Bearer k');
    expect(seen!.body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'user' }]);
  });
  it('turns bad responses into LlmUnavailable', async () => {
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(new OpenAiCompatibleLlm({ baseUrl: 'https://x', model: 'm', fetchFn: bad }).complete('a', 'b')).rejects.toBeInstanceOf(LlmUnavailable);
    const junk = (async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })) as unknown as typeof fetch;
    await expect(new OpenAiCompatibleLlm({ baseUrl: 'https://x', model: 'm', fetchFn: junk }).complete('a', 'b')).rejects.toBeInstanceOf(LlmUnavailable);
  });
});

describe('readEnv', () => {
  it('names missing variables without printing values', () => {
    let message = '';
    try {
      readEnv({ DISCORD_APP_ID: 'secret-looking-value', DISCORD_PUBLIC_KEY: 'not-hex' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('DISCORD_PUBLIC_KEY');
    expect(message).toContain('SUPABASE_URL');
    expect(message).not.toContain('secret-looking-value');
    expect(message).not.toContain('not-hex');
  });
  it('accepts a full environment', () => {
    const env = readEnv({
      DISCORD_APP_ID: '1', DISCORD_PUBLIC_KEY: 'a'.repeat(64), DISCORD_BOT_TOKEN: 't', SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', APP_URL: 'https://rally.example', CRON_SECRET: '12345678',
    });
    expect(env.LLM_MODEL).toBeUndefined();
  });
});
