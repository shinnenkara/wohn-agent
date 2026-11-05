export interface Authorizer {
  accessToken(force?: boolean): Promise<string>;
}

export async function authedGet<T>(
  authorizer: Authorizer,
  fetchImpl: typeof fetch,
  url: string,
  options?: { allowStatus?: number[] },
): Promise<{ status: number; body: T | null }> {
  const response = await request(authorizer, fetchImpl, url, false);
  if (response.status === 401) {
    const retried = await request(authorizer, fetchImpl, url, true);
    return finish(retried, options?.allowStatus ?? []);
  }
  return finish(response, options?.allowStatus ?? []);
}

async function request(
  authorizer: Authorizer,
  fetchImpl: typeof fetch,
  url: string,
  force: boolean,
): Promise<Response> {
  const token = await authorizer.accessToken(force);
  return fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
}

async function finish<T>(response: Response, allowStatus: readonly number[]): Promise<{ status: number; body: T | null }> {
  if (allowStatus.includes(response.status)) {
    return { status: response.status, body: null };
  }
  if (!response.ok) {
    throw new Error(`google returned ${response.status}`);
  }
  const body = (await response.json()) as T;
  return { status: response.status, body };
}
