import { z } from "zod";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expiry: z.string().min(1),
  token_type: z.string().optional(),
});

export interface GoogleToken {
  access_token: string;
  refresh_token: string;
  expiry: string;
  token_type: string;
}

const GrantSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  token_type: z.string().optional(),
  error: z.string().optional(),
});

export function parseGoogleToken(json: string): GoogleToken {
  const parsed = TokenSchema.parse(JSON.parse(json));
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expiry: parsed.expiry,
    token_type: parsed.token_type ?? "Bearer",
  };
}

export function tokenExpired(token: GoogleToken, now: Date): boolean {
  return new Date(token.expiry).getTime() - now.getTime() < 60_000;
}

export function authorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeAuthCode(
  fetchImpl: typeof fetch,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; now: Date },
): Promise<GoogleToken> {
  return requestToken(fetchImpl, input.now, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  fetchImpl: typeof fetch,
  input: { clientId: string; clientSecret: string; refreshToken: string; now: Date },
): Promise<GoogleToken> {
  return requestToken(fetchImpl, input.now, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
  }, input.refreshToken);
}

async function requestToken(
  fetchImpl: typeof fetch,
  now: Date,
  body: Record<string, string>,
  previousRefresh?: string,
): Promise<GoogleToken> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "";
    if (error === "invalid_grant") {
      throw new Error("Google login expired. Run npm run login.");
    }
    throw new Error("could not finish the google login");
  }
  const grant = GrantSchema.parse(payload);
  const refresh = grant.refresh_token || previousRefresh;
  if (!refresh) {
    throw new Error(
      "google did not return a reusable login. Remove this app's access in the Google account page and run npm run login again",
    );
  }
  return {
    access_token: grant.access_token,
    refresh_token: refresh,
    expiry: new Date(now.getTime() + grant.expires_in * 1000).toISOString(),
    token_type: grant.token_type ?? "Bearer",
  };
}
