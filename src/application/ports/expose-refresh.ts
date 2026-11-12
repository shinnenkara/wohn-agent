export interface ExposeRefreshQueue {
  enqueue(scoutId: string, at: Date): boolean;
  next(): string | null;
  finish(scoutId: string): void;
  fail(scoutId: string, detail: string): void;
}
