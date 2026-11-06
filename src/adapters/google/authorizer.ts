import { z } from "zod";
import { googleEndpoint } from "./google-credentials.js";
import type { Authorizer } from "./authed-get.js";

const NOT_CONNECTED = "Google is not connected. Run npm run login.";
const LOGIN_EXPIRED = "Google login expired. Run npm run login.";

const AccessTokenSchema = z.strictObject({
  access_token: z.string().min(1),
  expiry: z.string().min(1),
});

export function createAuthorizer(input: {
  googleUrl: string;
  deviceToken: string;
  fetchImpl: typeof fetch;
  now(): Date;
}): Authorizer {
  let cached: { accessToken: string; expiry: string } | null = null;
  return {
    async accessToken(force?: boolean): Promise<string> {
      if (!force && cached && accessTokenCurrent(cached.expiry, input.now())) {
        return cached.accessToken;
      }
      const url = new URL(googleEndpoint(input.googleUrl, "/v1/access-token"));
      if (force) {
        url.searchParams.set("force", "1");
      }
      const response = await input.fetchImpl(url.toString(), {
        headers: { authorization: `Bearer ${input.deviceToken}` },
      });
      if (response.status === 401) {
        throw new Error(await loginError(response));
      }
      if (!response.ok) {
        throw new Error(`google login failed with ${response.status}`);
      }
      const parsed = AccessTokenSchema.safeParse(await readJson(response));
      if (!parsed.success) {
        throw new Error("google login returned an unexpected body");
      }
      cached = { accessToken: parsed.data.access_token, expiry: parsed.data.expiry };
      return cached.accessToken;
    },
  };
}

function accessTokenCurrent(expiry: string, now: Date): boolean {
  const time = new Date(expiry).getTime();
  return !Number.isNaN(time) && time - now.getTime() >= 60_000;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function loginError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body.error === LOGIN_EXPIRED || body.error === NOT_CONNECTED) {
      return body.error;
    }
  } catch {
    return NOT_CONNECTED;
  }
  return NOT_CONNECTED;
}
