import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DemoCalendar } from '../adapters/calendar/demo';
import { GoogleCalendar } from '../adapters/calendar/google';
import { HybridCalendar } from '../adapters/calendar/hybrid';
import { GoogleOAuth } from '../adapters/calendar/oauth';
import { DiscordPlatform } from '../adapters/platform/discord';
import { SupabaseStore } from '../adapters/store/supabase';
import { NullLlm, OpenAiCompatibleLlm, polish } from '../lib/llm';
import { readEnv, type AppEnv } from '../lib/env';
import { Orchestrator, type CircleRecord } from './orchestrator';
import type { InteractionContext } from './interactions';

export interface Runtime {
  env: AppEnv;
  app: Orchestrator;
  /** Undefined when Google is not configured (the demo calendar is used instead). */
  oauth: GoogleOAuth | undefined;
  ctx: InteractionContext;
  verifyState(person: string, state: string): Promise<boolean>;
}

/** Wire the real adapters from the environment. Used by the HTTP routes. */
export function buildRuntime(source: Record<string, string | undefined> = process.env): Runtime {
  const env = readEnv(source);
  const store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const mode = env.CALENDAR_MODE ?? 'google';
  const useGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && mode !== 'demo';
  const oauth = useGoogle
    ? new GoogleOAuth({ clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, redirectUri: `${env.APP_URL.replace(/\/$/, '')}/api/google/callback` }, store)
    : undefined;
  const google = oauth ? new GoogleCalendar({ accessToken: (p) => oauth.accessToken(p) }) : undefined;
  const calendar = google ? (mode === 'hybrid' ? new HybridCalendar(google, new DemoCalendar(store)) : google) : new DemoCalendar(store);
  const platform = new DiscordPlatform({
    botToken: env.DISCORD_BOT_TOKEN,
    channelOf: async (circle) => (await store.get<CircleRecord>('circle', circle))?.channelId,
  });
  const llm = env.LLM_BASE_URL && env.LLM_MODEL ? new OpenAiCompatibleLlm({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL }) : new NullLlm();
  const app = new Orchestrator({ store, calendar, platform, now: Date.now, polish: (text) => polish(llm, text) });
  const ctx: InteractionContext = {
    app,
    now: Date.now,
    connectUrl: async (person) => {
      if (!oauth) return undefined;
      const secret = randomBytes(16).toString('hex');
      await store.put('oauthstate', person, secret);
      return oauth.authUrl(person, secret);
    },
  };
  return {
    env,
    app,
    oauth,
    ctx,
    verifyState: async (person, state) => {
      const stored = await store.get<string>('oauthstate', person);
      if (!stored || stored.length !== state.length) return false;
      const ok = timingSafeEqual(Buffer.from(stored), Buffer.from(state));
      if (ok) await store.del('oauthstate', person);
      return ok;
    },
  };
}

export function sameSecret(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
