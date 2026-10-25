import { RALLY_COMMAND } from '../src/adapters/platform/commands';

const app = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guild = process.env.DISCORD_DEV_GUILD_ID;
if (!app || !token) {
  console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN (see .env.example).');
  process.exit(2);
}

async function main(): Promise<void> {
  const base = `https://discord.com/api/v10/applications/${app}`;
  const url = guild ? `${base}/guilds/${guild}/commands` : `${base}/commands`;
  const res = await fetch(url, { method: 'PUT', headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify([RALLY_COMMAND]) });
  if (!res.ok) {
    console.error(`Discord refused the commands (status ${res.status}).`);
    process.exit(1);
  }
  console.log(`Registered /rally ${guild ? 'for the dev server' : 'globally'}.`);
}

void main();
