export interface Authorizer {
  accessToken(force?: boolean): Promise<string>;
}

export class GoogleQuotaError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "GoogleQuotaError";
    this.retryAfterMs = retryAfterMs;
  }
}

export async function authedGet<T>(
  authorizer: Authorizer,
  fetchImpl: typeof fetch,
  url: string,
  options?: { allowStatus?: number[] },
): Promise<{ status: number; body: T | null }> {
  const response = await request(authorizer, fetchImpl, url, false);
  if (response.response.status === 401) {
    const retried = await request(authorizer, fetchImpl, url, true);
    return finish(retried.response, retried.url, options?.allowStatus ?? []);
  }
  return finish(response.response, response.url, options?.allowStatus ?? []);
}

async function request(
  authorizer: Authorizer,
  fetchImpl: typeof fetch,
  url: string,
  force: boolean,
): Promise<{ response: Response; url: string }> {
  const token = await authorizer.accessToken(force);
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  return { response, url };
}

async function finish<T>(response: Response, url: string, allowStatus: readonly number[]): Promise<{ status: number; body: T | null }> {
  if (allowStatus.includes(response.status)) {
    return { status: response.status, body: null };
  }
  if (!response.ok) {
    const failure = await googleFailure(response, url);
    if (failure.quota) {
      throw new GoogleQuotaError(failure.message, quotaDelay(response.headers.get("retry-after")));
    }
    throw new Error(failure.message);
  }
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function googleFailure(response: Response, url: string): Promise<{ message: string; quota: boolean }> {
  const target = requestTarget(url);
  let detail = "";
  let quota = response.status === 429;
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown; status?: unknown; errors?: Array<{ reason?: unknown; message?: unknown }> };
    };
    const reason = text(payload.error?.errors?.[0]?.reason) || text(payload.error?.status);
    const message = text(payload.error?.message) || text(payload.error?.errors?.[0]?.message);
    quota = quota || reason === "rateLimitExceeded" || message.includes("rateLimitExceeded");
    detail = [reason, message].filter(Boolean).join(": ");
  } catch {
    detail = "";
  }
  const line = detail === "" ? `Google ${response.status} for ${target}` : `Google ${response.status} for ${target}: ${detail}`;
  return { message: line, quota };
}

function quotaDelay(header: string | null): number {
  const value = header?.trim() ?? "";
  if (!value) {
    return 60_000;
  }
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const when = Date.parse(value);
  if (!Number.isNaN(when)) {
    return Math.max(1000, when - Date.now());
  }
  return 60_000;
}

function requestTarget(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return "google";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}
