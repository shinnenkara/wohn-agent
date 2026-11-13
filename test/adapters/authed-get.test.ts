import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authedGet, GoogleQuotaError } from "../../src/adapters/google/authed-get.js";

describe("authed google get", () => {
  it("names the call and Google's reason when the request is refused", async () => {
    await assert.rejects(
      () =>
        authedGet(
          { async accessToken() { return "token"; } },
          async () =>
            Response.json(
              {
                error: {
                  status: "PERMISSION_DENIED",
                  message: "Request had insufficient authentication scopes.",
                  errors: [{ reason: "insufficientPermissions", message: "Insufficient Permission" }],
                },
              },
              { status: 403 },
            ),
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        ),
      /Google 403 for gmail\.googleapis\.com\/gmail\/v1\/users\/me\/profile: insufficientPermissions: Request had insufficient authentication scopes\./,
    );
  });

  it("waits a minute when Google reports a rate limit and no retry time", async () => {
    await assert.rejects(
      () =>
        authedGet(
          { async accessToken() { return "token"; } },
          async () =>
            Response.json(
              { error: { errors: [{ reason: "rateLimitExceeded", message: "Quota exceeded" }] } },
              { status: 403 },
            ),
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/abc",
        ),
      (error: unknown) => {
        assert.ok(error instanceof GoogleQuotaError);
        assert.equal(error.retryAfterMs, 60_000);
        assert.match(error.message, /rateLimitExceeded/);
        return true;
      },
    );
  });
});
