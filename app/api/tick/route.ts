import { buildRuntime, sameSecret } from '../../../src/app/runtime';

export const dynamic = 'force-dynamic';

/** Called every few minutes by the scheduler (see supabase/migrations/001_init.sql). */
export async function POST(request: Request): Promise<Response> {
  let rt;
  try {
    rt = buildRuntime();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!sameSecret(request.headers.get('x-cron-secret'), rt.env.CRON_SECRET)) return new Response('forbidden', { status: 403 });
  return Response.json(await rt.app.tick());
}
