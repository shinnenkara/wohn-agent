import type { AccountStore } from "../../application/ports/account-store.js";
import type { Authorizer } from "./authed-get.js";
import { parseGoogleToken, refreshAccessToken, tokenExpired, type GoogleToken } from "./oauth.js";

export function createAuthorizer(input: {
  accounts: AccountStore;
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
  now(): Date;
}): Authorizer {
  return {
    async accessToken(force?: boolean): Promise<string> {
      const account = input.accounts.load();
      if (!account) {
        throw new Error("Google is not connected. Run npm run login.");
      }
      let token = parseGoogleToken(account.tokenJson);
      if (force || tokenExpired(token, input.now())) {
        token = await refresh(input, token);
        input.accounts.saveToken(JSON.stringify(token));
      }
      return token.access_token;
    },
  };
}

async function refresh(
  input: { clientId: string; clientSecret: string; fetchImpl: typeof fetch; now(): Date },
  token: GoogleToken,
): Promise<GoogleToken> {
  return refreshAccessToken(input.fetchImpl, {
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: token.refresh_token,
    now: input.now(),
  });
}
