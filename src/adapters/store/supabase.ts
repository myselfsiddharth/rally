import { z } from 'zod';
import type { StorePort } from './port';

const Rows = z.array(z.object({ key: z.string(), value: z.unknown() }));

/** The store on Supabase, through its REST interface (PostgREST). The service key stays on the server. */
export class SupabaseStore implements StorePort {
  constructor(
    private url: string,
    private serviceKey: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.serviceKey, authorization: `Bearer ${this.serviceKey}`, 'content-type': 'application/json', ...extra };
  }
  private table = (q = '') => `${this.url.replace(/\/$/, '')}/rest/v1/rally_kv${q}`;
  private async check(res: Response, what: string): Promise<void> {
    if (!res.ok) throw new Error(`store ${what} failed with status ${res.status}`);
  }

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    const res = await this.fetchFn(this.table(`?ns=eq.${encodeURIComponent(ns)}&key=eq.${encodeURIComponent(key)}&select=key,value`), { headers: this.headers() });
    await this.check(res, 'read');
    const rows = Rows.parse(await res.json());
    return rows[0]?.value as T | undefined;
  }
  async put<T>(ns: string, key: string, value: T): Promise<void> {
    const res = await this.fetchFn(this.table('?on_conflict=ns,key'), {
      method: 'POST',
      headers: this.headers({ prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ ns, key, value }),
    });
    await this.check(res, 'write');
  }
  async list<T>(ns: string): Promise<T[]> {
    const res = await this.fetchFn(this.table(`?ns=eq.${encodeURIComponent(ns)}&select=key,value&order=key.asc`), { headers: this.headers() });
    await this.check(res, 'list');
    return Rows.parse(await res.json()).map((r) => r.value as T);
  }
  async del(ns: string, key: string): Promise<void> {
    const res = await this.fetchFn(this.table(`?ns=eq.${encodeURIComponent(ns)}&key=eq.${encodeURIComponent(key)}`), { method: 'DELETE', headers: this.headers() });
    await this.check(res, 'delete');
  }
}
