export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
