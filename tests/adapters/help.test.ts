import { afterEach, describe, expect, it } from 'vitest';
import { DemoCalendar } from '../../src/adapters/calendar/demo';
import { RALLY_COMMAND } from '../../src/adapters/platform/commands';
import { FakePlatform } from '../../src/adapters/platform/fake';
import { MemoryStore } from '../../src/adapters/store/memory';
import { GET as addRoute } from '../../app/add/route';
import { GUIDE, WELCOME_HINT, helpText } from '../../src/app/guide';
import { handleInteraction, type InteractionContext } from '../../src/app/interactions';
import { inviteUrl } from '../../src/app/invite';
import { Orchestrator } from '../../src/app/orchestrator';

const subcommands = RALLY_COMMAND.options.map((o) => o.name);

describe('the guide', () => {
  it('fits in one Discord message', () => {
    expect(helpText().length).toBeLessThan(2000);
  });
  it('mentions every command Rally has, so help can never fall behind', () => {
    const text = helpText();
    for (const name of subcommands.filter((n) => n !== 'help')) expect(text, `help is missing /rally ${name}`).toContain(`/rally ${name}`);
  });
  it('only describes commands that exist', () => {
    for (const g of GUIDE) expect(subcommands, g.command).toContain(g.command.split(' ')[1]);
  });
  it('gives a first-time order: circle, join, plan', () => {
    const steps = GUIDE.filter((g) => g.step).sort((a, b) => a.step! - b.step!).map((g) => g.command.split(' ')[1]);
    expect(steps).toEqual(['newcircle', 'join', 'plan']);
  });
  it('tells people about the demo, direct messages and the demo calendar', () => {
    const text = helpText();
    expect(text).toContain('/rally demo');
    expect(text.toLowerCase()).toContain('direct messages');
    expect(text.toLowerCase()).toContain('demo one');
  });
});

describe('/rally help in Discord', () => {
  function world() {
    const store = new MemoryStore();
    const app = new Orchestrator({ store, calendar: new DemoCalendar(store), platform: new FakePlatform(), now: () => Date.UTC(2026, 9, 26, 17) });
    const ctx: InteractionContext = { app, now: () => Date.UTC(2026, 9, 26, 17), connectUrl: async () => undefined };
    return { app, ctx, store };
  }
  const cmd = (id: string, sub: string, values: Record<string, string> = {}) => ({
    type: 2, channel_id: 'chan', member: { user: { id, username: id } },
    data: { name: 'rally', options: [{ name: sub, type: 1, options: Object.entries(values).map(([name, value]) => ({ name, type: 3, value })) }] },
  });
  const say = async (w: ReturnType<typeof world>, id: string, sub: string, v?: Record<string, string>) => ((await handleInteraction(cmd(id, sub, v), w.ctx)).body as any).data.content as string;

  it('shows the guide privately and does not sign anyone up just for looking', async () => {
    const w = world();
    const res = await handleInteraction(cmd('newbie', 'help'), w.ctx);
    expect((res.body as any).data.flags).toBe(64);
    expect((res.body as any).data.content).toBe(helpText());
    expect(await w.app.person('newbie')).toBeUndefined();
  });
  it('points a brand-new person to the guide once, on their first real command only', async () => {
    const w = world();
    expect(await say(w, 'u1', 'status')).toContain(WELCOME_HINT.trim());
    expect(await say(w, 'u1', 'status')).not.toContain('/rally help');
    expect(await say(w, 'u2', 'newcircle', { name: 'Dorm' })).toContain('/rally help');
  });
  it('answers an unknown subcommand by pointing at help', async () => {
    const w = world();
    expect(await say(w, 'u1', 'wat')).toContain('/rally help');
  });
});

describe('Add to Discord link', () => {
  const saved = process.env.DISCORD_APP_ID;
  afterEach(() => { if (saved === undefined) delete process.env.DISCORD_APP_ID; else process.env.DISCORD_APP_ID = saved; });

  it('builds an invite that asks for the bot and slash commands, and only permission to send messages', () => {
    const u = new URL(inviteUrl('123456789012345678'));
    expect(u.origin + u.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(u.searchParams.get('client_id')).toBe('123456789012345678');
    expect(u.searchParams.get('scope')).toBe('bot applications.commands');
    expect(u.searchParams.get('permissions')).toBe('2048');
  });
  it('/add redirects to it when the app is configured', () => {
    process.env.DISCORD_APP_ID = '123456789012345678';
    const res = addRoute();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(inviteUrl('123456789012345678'));
  });
  it('/add says plainly that it is not ready, instead of redirecting somewhere broken', async () => {
    delete process.env.DISCORD_APP_ID;
    expect(addRoute().status).toBe(503);
    process.env.DISCORD_APP_ID = 'not a number';
    const res = addRoute();
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not set up');
  });
});
