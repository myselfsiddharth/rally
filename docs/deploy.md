# Deploying Rally

Everything runs on free tiers: Vercel (the app and bot endpoint), Supabase (storage and the scheduler), Discord (the bot) and Google Cloud (calendar access). You do the account steps; the code is ready for them. Never paste secrets into chat or commit them: they go in `.env.local` and in Vercel's environment settings.

Copy `.env.example` to `.env.local` and fill it in as you go.

## 1. Supabase

1. Create a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/001_init.sql` (creates the `rally_kv` table with row level security on and no policies, so only the service key can touch it).
3. Settings, then API: copy the project URL into `SUPABASE_URL` and the **service_role** key into `SUPABASE_SERVICE_ROLE_KEY`. Keep that key on the server only.

## 2. Discord

1. discord.com/developers/applications, then New Application. Copy the **Application ID** (`DISCORD_APP_ID`) and **Public Key** (`DISCORD_PUBLIC_KEY`).
2. Bot tab: Reset Token, copy it into `DISCORD_BOT_TOKEN`. No privileged intents are needed: Rally never reads channel messages.
3. OAuth2, then URL Generator: scopes `bot` and `applications.commands`; bot permissions Send Messages. Open the link and add the bot to a test server.
4. Enable Developer Mode in Discord settings, right-click your test server, Copy Server ID into `DISCORD_DEV_GUILD_ID` (commands update instantly for one server).
5. Later, after Vercel is set up, set **Interactions Endpoint URL** to `https://YOUR-APP.vercel.app/api/discord`. Discord sends a signed ping to verify it.
6. Register the command: `npm run register-commands`.

## 3. Google Calendar

1. console.cloud.google.com: create a project and enable the **Google Calendar API**.
2. OAuth consent screen: External, add yourself and friends as **test users** (a test-mode app can have up to 100 without Google's review).
3. Credentials, then Create OAuth client ID, type Web application. Authorized redirect URI: `https://YOUR-APP.vercel.app/api/google/callback`.
4. Copy the client id and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Rally asks for two scopes only: `calendar.freebusy` (when you are busy, never what for) and `calendar.events` (to add an event you agreed to).

## 4. Vercel

1. Import this repository at vercel.com.
2. Add every variable from `.env.example` in Settings, then Environment Variables. `APP_URL` is your production URL (for example `https://rally-yourname.vercel.app`). `CRON_SECRET` is any random string of 8 or more characters.
3. Deploy, then finish Discord step 5.

## 5. The scheduler

The bot does its proactive work (spotting birthdays, running a round of coffee matching, timing out plans nobody answered) from `POST /api/tick`. In Supabase, enable the `pg_cron` and `pg_net` extensions, then run the commented `cron.schedule` block at the bottom of `001_init.sql` with your URL and secret. Every 5 minutes is plenty. The tick is safe to run twice.

## 6. Try it

In your Discord server: `/rally newcircle name:Dorm`, then each friend `/rally join code:XXXXXX`, `/rally connect`, and `/rally birthday`. A host runs `/rally plan occasion:hangout`. Everyone's agent will message them.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Discord says the endpoint URL is invalid | `DISCORD_PUBLIC_KEY` is wrong or not set on Vercel; the route answers 401 to anything not signed by Discord |
| `/api/...` returns 500 naming a variable | That environment variable is missing or malformed; values are never printed |
| `/rally connect` says calendar connection is not set up | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing |
| Google shows "access blocked" | The person is not on the consent screen's test users list |
| Nothing proactive ever happens | The tick is not scheduled, or `CRON_SECRET` differs between Vercel and the scheduler |
| A friend never gets DMs | Discord only lets a bot DM people who share a server with it |
