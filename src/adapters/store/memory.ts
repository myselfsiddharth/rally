import type { StorePort } from './port';

/** For tests and local runs. Values are copied so callers cannot change stored data by accident. */
export class MemoryStore implements StorePort {
  private data = new Map<string, string>();
  private k = (ns: string, key: string) => `${ns}\u0000${key}`;

  async get<T>(ns: string, key: string): Promise<T | undefined> {
    const v = this.data.get(this.k(ns, key));
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async put<T>(ns: string, key: string, value: T): Promise<void> {
    this.data.set(this.k(ns, key), JSON.stringify(value));
  }
  async list<T>(ns: string): Promise<T[]> {
    const prefix = `${ns}\u0000`;
    return [...this.data.entries()].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => JSON.parse(v) as T);
  }
  async del(ns: string, key: string): Promise<void> {
    this.data.delete(this.k(ns, key));
  }
}
