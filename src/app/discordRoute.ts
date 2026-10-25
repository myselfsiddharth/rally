import { InteractionSchema, verifyDiscordSignature } from '../adapters/platform/discord';
import { editOriginal, toFollowUp } from './followup';
import { handleInteraction, type InteractionContext } from './interactions';

const COMMAND = 2;
const COMPONENT = 3;
const DEFERRED_MESSAGE = 5;
const DEFERRED_UPDATE = 6;
const EPHEMERAL = 64;

export interface DiscordRouteDeps {
  runtime: () => { env: { DISCORD_PUBLIC_KEY: string; DISCORD_APP_ID: string }; ctx: InteractionContext };
  /** Run work after the response has been sent (Next's `after`). */
  defer: (work: () => Promise<void>) => void;
  fetchFn?: typeof fetch;
}

/**
 * Discord gives an app 3 seconds to answer. So: verify the signature, answer straight away with "thinking...", and do the
 * real work afterwards, filling in the reply when it is ready. If the work fails, the student still gets an answer.
 */
export async function handleDiscordRequest(request: Request, deps: DiscordRouteDeps): Promise<Response> {
  const raw = await request.text();
  let rt;
  try {
    rt = deps.runtime();
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
  const parsed = InteractionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'bad interaction' }, { status: 400 });
  const { type, token } = parsed.data as { type: number; token?: string };

  if ((type === COMMAND || type === COMPONENT) && token) {
    deps.defer(async () => {
      let out;
      try {
        out = toFollowUp((await handleInteraction(body, rt.ctx)).body);
      } catch {
        out = { content: 'Something went wrong on my side. Please try that again in a moment.' };
      }
      try {
        await editOriginal(rt.env.DISCORD_APP_ID, token, out, deps.fetchFn);
      } catch {
        /* the token may have expired; there is nobody left to tell */
      }
    });
    return Response.json(type === COMMAND ? { type: DEFERRED_MESSAGE, data: { flags: EPHEMERAL } } : { type: DEFERRED_UPDATE });
  }

  const res = await handleInteraction(body, rt.ctx);
  return Response.json(res.body, { status: res.status });
}
