import { after } from 'next/server';
import { handleDiscordRequest } from '../../../src/app/discordRoute';
import { buildRuntime } from '../../../src/app/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleDiscordRequest(request, { runtime: () => buildRuntime(), defer: (work) => after(work) });
}
