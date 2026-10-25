import { buildRuntime } from '../../../../src/app/runtime';

export const dynamic = 'force-dynamic';

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:15vh auto;padding:0 1.5rem"><h1>${title}</h1><p>${body}</p>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

/** Google sends the student back here after they approve calendar access. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const dot = state.indexOf('.');
  if (!code || dot < 1) return page('Something went wrong', 'That sign-in link was not valid. Run /rally connect again.', 400);
  const person = state.slice(0, dot);
  let rt;
  try {
    rt = buildRuntime();
  } catch {
    return page('Not set up yet', 'Rally is not configured on this server.', 500);
  }
  if (!(await rt.verifyState(person, state.slice(dot + 1)))) return page('Something went wrong', 'That sign-in link expired. Run /rally connect again.', 400);
  try {
    await rt.oauth.exchange(person, code);
  } catch {
    return page('Could not connect', 'Google did not accept that. Run /rally connect and try again.', 502);
  }
  return page('Calendar connected', 'You can close this tab. Your agent now sees when you are free, and only that.');
}
