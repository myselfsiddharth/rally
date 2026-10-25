/** What we send back to Discord to fill in a reply we promised earlier. */
export interface FollowUp {
  content: string;
  components?: unknown[];
}

/**
 * Edit the "thinking..." message Discord is showing. The interaction token in the URL is the credential, so no
 * bot token is needed, and it is never put in an error message.
 */
export async function editOriginal(appId: string, token: string, body: FollowUp, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: body.content.slice(0, 1990), components: body.components ?? [] }),
  });
  if (!res.ok) throw new Error(`Discord follow-up failed with status ${res.status}`);
}

/** Turn the handler's immediate-style reply into the content for a follow-up edit. */
export function toFollowUp(reply: unknown): FollowUp {
  const data = (reply as { data?: { content?: unknown; components?: unknown[] } } | undefined)?.data;
  return { content: typeof data?.content === 'string' && data.content ? data.content : 'Done.', components: data?.components };
}
