import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import type { CircleId, PersonId } from '../../engine/types';
import type { Button, PlatformPort } from './port';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Discord signs every request. Reject anything whose Ed25519 signature does not match our application's public key. */
export function verifyDiscordSignature(publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string): boolean {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex) || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

const User = z.object({ id: z.string(), username: z.string().optional(), global_name: z.string().nullish() });
export type DiscordOption = { name: string; type: number; value?: string | number | boolean; options?: DiscordOption[] };
const Option: z.ZodType<DiscordOption> = z.lazy(() =>
  z.object({ name: z.string(), type: z.number(), value: z.union([z.string(), z.number(), z.boolean()]).optional(), options: z.array(Option).optional() }),
);

export const InteractionSchema = z.object({
  type: z.number(),
  channel_id: z.string().optional(),
  member: z.object({ user: User }).optional(),
  user: User.optional(),
  message: z.object({ content: z.string().optional() }).optional(),
  data: z
    .object({
      name: z.string().optional(),
      custom_id: z.string().optional(),
      options: z.array(Option).optional(),
      resolved: z.object({ users: z.record(z.string(), User).optional() }).optional(),
    })
    .optional(),
});
export type Interaction = z.infer<typeof InteractionSchema>;

export function actorOf(i: Interaction): { id: PersonId; name: string } | undefined {
  const u = i.member?.user ?? i.user;
  return u ? { id: u.id, name: u.global_name ?? u.username ?? 'friend' } : undefined;
}

const STYLE = { primary: 1, secondary: 2, danger: 4 } as const;

/** Sends messages through Discord's REST API. A student's Discord user id is their Rally id. */
export class DiscordPlatform implements PlatformPort {
  private channels = new Map<string, string>();
  constructor(
    private cfg: { botToken: string; channelOf: (circle: CircleId) => Promise<string | undefined>; fetchFn?: typeof fetch },
  ) {}

  private async call(path: string, body: unknown): Promise<unknown> {
    const res = await (this.cfg.fetchFn ?? fetch)(`https://discord.com/api/v10${path}`, {
      method: 'POST',
      headers: { authorization: `Bot ${this.cfg.botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord ${path.split('/')[1]} request failed with status ${res.status}`);
    return res.json();
  }

  private components(buttons: Button[]) {
    return buttons.length === 0
      ? []
      : [{ type: 1, components: buttons.slice(0, 5).map((b) => ({ type: 2, style: STYLE[b.style ?? 'secondary'], label: b.label.slice(0, 80), custom_id: b.id })) }];
  }

  async dm(person: PersonId, text: string, buttons: Button[] = []): Promise<void> {
    let channel = this.channels.get(person);
    if (!channel) {
      const made = z.object({ id: z.string() }).parse(await this.call('/users/@me/channels', { recipient_id: person }));
      channel = made.id;
      this.channels.set(person, channel);
    }
    await this.call(`/channels/${channel}/messages`, { content: text, components: this.components(buttons) });
  }

  async post(circle: CircleId, text: string): Promise<void> {
    const channel = await this.cfg.channelOf(circle);
    if (channel) await this.call(`/channels/${channel}/messages`, { content: text });
  }
}
