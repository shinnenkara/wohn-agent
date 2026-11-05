import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startLoopback } from "../../src/adapters/google/loopback.js";

describe("google login loopback", () => {
  it("returns the code and closes while the browser still holds the socket", async () => {
    const loop = await startLoopback("state-1");
    try {
      const response = await fetch(`${loop.redirectUri}?code=auth-code&state=state-1`);
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(await loop.code, "auth-code");
      const started = Date.now();
      await loop.close();
      assert.ok(Date.now() - started < 1000);
    } finally {
      await loop.close();
    }
  });
});
