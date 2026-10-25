import { verifyDiscordSignature } from '../../../src/adapters/platform/discord';
import { handleInteraction } from '../../../src/app/interactions';
import { buildRuntime } from '../../../src/app/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  let rt;
  try {
    rt = buildRuntime();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  const ok = verifyDiscordSignature(rt.env.DISCORD_PUBLIC_KEY, request.headers.get('x-signature-ed25519') ?? '', request.headers.get('x-signature-timestamp') ?? '', raw);
  if (!ok) return new Response('invalid request signature', { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const res = await handleInteraction(body, rt.ctx);
  return Response.json(res.body, { status: res.status });
}
