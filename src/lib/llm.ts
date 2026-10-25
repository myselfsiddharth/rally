import { z } from 'zod';
import { passesHardLines } from './filter';

export class LlmUnavailable extends Error {
  constructor(message = 'no language model configured') {
    super(message);
  }
}

/** The one interface to a language model. Any OpenAI-compatible service works. */
export interface Llm {
  complete(system: string, user: string): Promise<string>;
}

export class NullLlm implements Llm {
  async complete(): Promise<string> {
    throw new LlmUnavailable();
  }
}

const ChatResponse = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) });

export class OpenAiCompatibleLlm implements Llm {
  constructor(
    private cfg: { baseUrl: string; apiKey?: string; model: string; fetchFn?: typeof fetch; timeoutMs?: number },
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 6000);
    try {
      const res = await fetchFn(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.cfg.model,
          max_tokens: 140,
          temperature: 0.7,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) throw new LlmUnavailable(`model request failed with status ${res.status}`);
      const parsed = ChatResponse.safeParse(await res.json());
      if (!parsed.success) throw new LlmUnavailable('model returned an unexpected response');
      return parsed.data.choices[0]!.message.content.trim();
    } catch (e) {
      if (e instanceof LlmUnavailable) throw e;
      throw new LlmUnavailable('model request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

const SYSTEM =
  'You rewrite short messages from a friendly planning assistant for college students. Keep every name, number, date and time exactly as given. ' +
  'Sound warm and casual in one or two short sentences. Never add new facts. Never mention anyone\'s body, health, money, family, religion or identity.';

/** Facts that must survive a rewrite: numbers (with their units) and capitalised words. */
function facts(text: string): string[] {
  return [...(text.match(/\d[\d:]*\s?(?:am|pm)?|\b[A-Z][a-z]+\b/g) ?? [])].map((s) => s.trim().toLowerCase());
}

/**
 * Optionally make a fixed message warmer. The result is used only if it keeps every name and time from the
 * original and passes the hard-line filter; otherwise, or if the model fails, the original is used.
 */
export async function polish(llm: Llm, text: string): Promise<string> {
  try {
    const out = (await llm.complete(SYSTEM, text)).replace(/^["']|["']$/g, '').trim();
    if (!passesHardLines(out)) return text;
    const lower = out.toLowerCase();
    return facts(text).every((f) => lower.includes(f)) ? out : text;
  } catch {
    return text;
  }
}
