import type { SelectorCacheEntry } from "../../domain/selector-cache-entry.js";

export interface SelectorCache {
  get(actionKey: string): SelectorCacheEntry | null;
  upsert(entry: SelectorCacheEntry): void;
  invalidate(actionKey: string): void;
  recordFailure(actionKey: string): void;
}
