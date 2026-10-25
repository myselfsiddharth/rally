import { z } from 'zod';
import { passesHardLines } from '../lib/filter';
import { HOUR, DAY, isValidTimezone, localToInstant } from '../engine/time';
import { actorOf, InteractionSchema, type DiscordOption, type Interaction } from '../adapters/platform/discord';
import type { Orchestrator } from './orchestrator';
import type { Occasion } from '../engine/tasks';
import type { Budget } from '../engine/types';

export interface InteractionContext {
  app: Orchestrator;
  now: () => number;
  /** A Google sign-in link for this person, or undefined if Google is not set up. */
  connectUrl: (person: string) => Promise<string | undefined>;
}

type Reply = { status: number; body: unknown };

const PING = 1;
const COMMAND = 2;
const COMPONENT = 3;
const MESSAGE = 4;
const UPDATE_MESSAGE = 7;
const EPHEMERAL = 64;

const reply = (content: string): Reply => ({ status: 200, body: { type: MESSAGE, data: { content, flags: EPHEMERAL } } });

function flatten(options: DiscordOption[] | undefined): { sub: string | undefined; values: Record<string, string | number | boolean> } {
  const first = options?.[0];
  if (first && first.type === 1) {
    const values: Record<string, string | number | boolean> = {};
    for (const o of first.options ?? []) if (o.value !== undefined) values[o.name] = o.value;
    return { sub: first.name, values };
  }
  return { sub: undefined, values: {} };
}

/** "2026-11-14" and "19:30" in the host's zone, as an instant, or undefined if they are not a real date and time. */
function parseWhen(date: string, time: string, tz: string): number | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return undefined;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return undefined;
  const probe = new Date(Date.UTC(y, mo - 1, da));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== da) return undefined; // e.g. February 30
  return localToInstant(y, mo, da, h, mi, tz);
}

const Strs = z.object({ code: z.string().min(1).max(12), name: z.string().min(1).max(40) });

/** Turn a verified Discord interaction into a response. Fast enough to answer inside Discord's 3 second window. */
export async function handleInteraction(raw: unknown, ctx: InteractionContext): Promise<Reply> {
  const parsed = InteractionSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: 'bad interaction' } };
  const i = parsed.data;
  if (i.type === PING) return { status: 200, body: { type: 1 } };
  const actor = actorOf(i);
  if (!actor) return reply('I could not tell who you are.');

  if (i.type === COMPONENT) {
    const customId = i.data?.custom_id;
    if (!customId) return reply('That button is not recognised.');
    const ack = await ctx.app.handleButton(actor.id, customId);
    const original = i.message?.content ?? '';
    return { status: 200, body: { type: UPDATE_MESSAGE, data: { content: `${original}\n\n${ack}`.trim(), components: [] } } };
  }
  if (i.type !== COMMAND || i.data?.name !== 'rally') return reply('I do not know that command.');
  return command(i, actor, ctx);
}

async function command(i: Interaction, actor: { id: string; name: string }, ctx: InteractionContext): Promise<Reply> {
  const { sub, values } = flatten(i.data?.options);
  const app = ctx.app;
  await app.ensurePerson(actor.id, actor.name);
  switch (sub) {
    case 'newcircle': {
      const v = Strs.pick({ name: true }).safeParse(values);
      if (!v.success || !i.channel_id) return reply('Give the circle a name, and run this in the channel your friends use.');
      const circle = await app.createCircle(i.channel_id, actor.id, v.data.name);
      return reply(`${circle.name} is ready. Friends join with: /rally join ${circle.code}`);
    }
    case 'join': {
      const v = Strs.pick({ code: true }).safeParse(values);
      const circle = v.success ? await app.joinCircle(v.data.code, actor.id) : undefined;
      return reply(circle ? `You are in ${circle.name}, with ${circle.members.length} people. Next: /rally connect so your agent can check when you are free.` : 'That code did not match a circle.');
    }
    case 'connect': {
      const url = await ctx.connectUrl(actor.id);
      return reply(url ? `Connect your calendar here (only free and busy times are ever shared, never what the events are): ${url}` : 'Real calendars are not turned on for this server, so your agent is using a made-up demo calendar for you. Everything else works the same.');
    }
    case 'birthday': {
      const ok = await app.setBirthday(actor.id, Number(values.month), Number(values.day));
      return reply(ok ? 'Got it. Your friends\' agents will offer to plan something a couple of weeks before.' : 'That does not look like a date.');
    }
    case 'demo': {
      const circles = await app.circlesOf(actor.id);
      const circle = circles.find((c) => c.channelId === i.channel_id) ?? (circles.length === 1 ? circles[0] : undefined);
      if (!circle) return reply('Make a circle first with /rally newcircle, then run this in its channel.');
      const names = await app.addDemoFriends(circle.id, actor.id);
      return reply(`Added ${names.join(', ')} to ${circle.name}. They are fictional and their agents answer on their own, with made-up calendars, so you can watch a whole plan alone. Now run /rally plan occasion:hangout.`);
    }
    case 'plan': {
      const occasion = String(values.occasion) as Occasion;
      if (!['birthday', 'halloween', 'hangout', 'concert'].includes(occasion)) return reply('Pick birthday, halloween, hangout or concert.');
      const circles = await app.circlesOf(actor.id);
      const circle = circles.find((c) => c.channelId === i.channel_id) ?? (circles.length === 1 ? circles[0] : undefined);
      if (!circle) return reply('Run this in your circle\'s channel, or join a circle first.');
      const honoree = typeof values.honoree === 'string' ? values.honoree : null;
      if (occasion === 'birthday' && !honoree) return reply('Say whose birthday it is.');
      let title = occasion === 'birthday' ? `${(await app.person(honoree!))?.name ?? 'Their'}'s birthday` : occasion === 'halloween' ? 'Halloween' : 'Hangout';
      let window: { start: number; end: number } | undefined;
      let durationMs: number | undefined;
      if (occasion === 'concert') {
        const when = parseWhen(String(values.date ?? ''), String(values.time ?? ''), (await app.person(actor.id))?.prefs.tz ?? 'America/Phoenix');
        if (!when) return reply('For a concert or event, give a date like 2026-11-14 and a time like 19:30.');
        const hours = typeof values.hours === 'number' ? Math.min(8, Math.max(1, values.hours)) : 3;
        const start = when;
        if (start < ctx.now() + 2 * HOUR) return reply('That time is too soon or already past. Pick one at least a couple of hours from now.');
        if (start > ctx.now() + 180 * DAY) return reply('That is more than six months away. Pick a nearer date.');
        title = typeof values.title === 'string' && values.title.trim() ? values.title.trim().slice(0, 60) : 'Concert';
        if (!passesHardLines(title)) return reply('Please pick a different name for the event.');
        window = { start, end: start + hours * HOUR };
        durationMs = hours * HOUR;
      }
      const res = await app.startParty({ circle: circle.id, host: actor.id, occasion, honoree, surprise: Boolean(values.surprise), title, window, durationMs });
      if (res.ok) return reply(`On it. I am checking everyone's calendars for ${title}. You will hear from me when there is something to decide.`);
      if (res.reason === 'party_cap') return reply('Your circle already has a party within the last 14 days, so I will not start another yet. I can plan it once that window is over.');
      if (res.reason === 'too_small') return reply('A party needs at least three people in the circle.');
      return reply('I could not start that.');
    }
    case 'prefs': {
      const patch: Record<string, unknown> = {};
      if (typeof values.quiet_from === 'number') patch.quietStartHour = values.quiet_from;
      if (typeof values.quiet_until === 'number') patch.quietEndHour = values.quiet_until;
      if (typeof values.coffee_per_week === 'number') patch.maxPairInvitesPerWeek = Math.min(3, Math.max(0, values.coffee_per_week));
      if (typeof values.car === 'boolean') patch.hasCar = values.car;
      if (typeof values.host === 'boolean') patch.canHost = values.host;
      if (typeof values.budget === 'string' && ['low', 'mid', 'high'].includes(values.budget)) patch.budget = values.budget as Budget;
      if (typeof values.timezone === 'string') {
        if (!isValidTimezone(values.timezone)) return reply('I do not know that time zone. Pick one from the list.');
        patch.tz = values.timezone;
      }
      if (Object.keys(patch).length === 0) return reply('Nothing to change. Pick at least one option.');
      await app.updatePrefs(actor.id, patch);
      return reply('Saved. Only what a job needs (like "can drive") is ever shared, never the reason.');
    }
    case 'skip': {
      const other = typeof values.person === 'string' ? values.person : '';
      const rec = await app.person(actor.id);
      if (!rec || !other) return reply('Pick someone.');
      await app.updatePrefs(actor.id, { neverSuggest: [...new Set([...rec.prefs.neverSuggest, other])] });
      return reply('Done. I will never set you up with them, and they will not be told.');
    }
    case 'status':
      return reply(await app.status(actor.id));
    case 'pause':
      await app.setPaused(actor.id, Boolean(values.on));
      return reply(values.on ? 'Paused. I will not set anything up until you resume.' : 'Back on.');
    case 'forget':
      await app.forget(actor.id);
      return reply('Everything Rally knew about you is deleted, including your calendar link.');
    default:
      return reply('Try /rally status.');
  }
}
