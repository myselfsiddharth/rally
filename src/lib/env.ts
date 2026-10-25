import { z } from 'zod';

const Env = z.object({
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters'),
  DISCORD_BOT_TOKEN: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Optional: without Google, everyone gets a clearly labelled made-up calendar so the bot can still be tried.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // google: only real calendars. demo: only made-up calendars. hybrid: real if connected, otherwise made-up.
  CALENDAR_MODE: z.enum(['google', 'demo', 'hybrid']).optional(),
  APP_URL: z.string().url(),
  CRON_SECRET: z.string().min(8),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
});

export type AppEnv = z.infer<typeof Env>;

/** Reads the environment. On failure, names the variables that are missing or invalid and never prints values. */
export function readEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = Env.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
  throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
}
