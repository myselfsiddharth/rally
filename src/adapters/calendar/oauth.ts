import { z } from 'zod';
import type { PersonId } from '../../engine/types';
import type { StorePort } from '../store/port';

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.events'];

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional() });

interface StoredToken {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** Sign-in with Google for calendar access. The refresh token lives in the store; nothing else is kept. */
export class GoogleOAuth {
  private fetchFn: typeof fetch;
  private now: () => number;
  constructor(
    private cfg: OAuthConfig,
    private store: StorePort,
  ) {
    this.fetchFn = cfg.fetchFn ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  authUrl(person: PersonId, secretState: string): string {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: `${person}.${secretState}`,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  private async token(body: Record<string, string>): Promise<z.infer<typeof TokenResponse>> {
    const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, ...body }),
    });
    if (!res.ok) throw new Error(`Google token request failed with status ${res.status}`);
    return TokenResponse.parse(await res.json());
  }

  /** Called from the OAuth redirect. */
  async exchange(person: PersonId, code: string): Promise<void> {
    const t = await this.token({ code, grant_type: 'authorization_code', redirect_uri: this.cfg.redirectUri });
    if (!t.refresh_token) throw new Error('Google did not return a refresh token');
    await this.store.put<StoredToken>('token', person, { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: this.now() + t.expires_in * 1000 });
  }

  async accessToken(person: PersonId): Promise<string | undefined> {
    const stored = await this.store.get<StoredToken>('token', person);
    if (!stored) return undefined;
    if (stored.accessToken && stored.expiresAt && stored.expiresAt - 60_000 > this.now()) return stored.accessToken;
    const t = await this.token({ refresh_token: stored.refreshToken, grant_type: 'refresh_token' });
    await this.store.put<StoredToken>('token', person, { refreshToken: stored.refreshToken, accessToken: t.access_token, expiresAt: this.now() + t.expires_in * 1000 });
    return t.access_token;
  }

  async disconnect(person: PersonId): Promise<void> {
    await this.store.del('token', person);
  }
}
