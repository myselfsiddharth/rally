import { inviteUrl } from '../../src/app/invite';

export const dynamic = 'force-dynamic';

/** A stable link to share anywhere: sends people to Discord's "add this bot to a server" screen. */
export function GET(): Response {
  const appId = process.env.DISCORD_APP_ID;
  if (!appId || !/^\d{5,25}$/.test(appId)) {
    return new Response('Rally is not set up to be added to servers yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return Response.redirect(inviteUrl(appId), 302);
}
