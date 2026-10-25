/** A tiny key-value store, grouped by namespace. Everything the bot remembers goes through this. */
export interface StorePort {
  get<T>(ns: string, key: string): Promise<T | undefined>;
  put<T>(ns: string, key: string, value: T): Promise<void>;
  list<T>(ns: string): Promise<T[]>;
  del(ns: string, key: string): Promise<void>;
}
