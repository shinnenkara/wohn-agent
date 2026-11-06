import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { createAuthorizer } from "../../src/adapters/google/authorizer.js";
import { googleEndpoint, loadGoogleCredentials } from "../../src/adapters/google/google-credentials.js";
import { SqliteAccountStore } from "../../src/adapters/sqlite/account-store.js";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { linkGoogle } from "../../src/infrastructure/login-main.js";

describe("google login", () => {
  it("reads a device token and ignores a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-google-"));
    try {
      assert.equal(loadGoogleCredentials(join(dir, "missing.json")), null);
      const broken = join(dir, "broken.json");
      writeFileSync(broken, "{", "utf8");
      assert.equal(loadGoogleCredentials(broken), null);
      const path = join(dir, "google.json");
      writeFileSync(path, `${JSON.stringify({ deviceToken: "device-token" })}\n`, "utf8");
      assert.deepEqual(loadGoogleCredentials(path), { deviceToken: "device-token" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the device token and address after Google links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-google-"));
    const path = join(dir, "google.json");
    const lines: string[] = [];
    const opened: string[] = [];
    const saved: string[] = [];
    let polls = 0;
    try {
      await linkGoogle({
        googleUrl: "https://google.example/",
        credentialsPath: path,
        timeoutMs: 5_000,
        pollMs: 1,
        sleep: async () => undefined,
        log: (line) => lines.push(line),
        open: (url) => opened.push(url),
        saveAccount: (email) => saved.push(email),
        fetchImpl: async (input, init) => {
          const url = String(input);
          if (url.endsWith("/v1/devices")) {
            assert.equal(init?.method, "POST");
            return Response.json({ deviceToken: "device-token", startUrl: "https://google.example/login?state=abc" });
          }
          assert.equal(url, "https://google.example/v1/session");
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer device-token");
          polls += 1;
          if (polls === 1) {
            return Response.json({ linked: false, email: null });
          }
          return Response.json({ linked: true, email: "a@example.com" });
        },
      });
      assert.deepEqual(opened, ["https://google.example/login?state=abc"]);
      assert.equal(lines.some((line) => line.includes("https://google.example/login?state=abc")), true);
      assert.deepEqual(saved, ["a@example.com"]);
      assert.deepEqual(loadGoogleCredentials(path), { deviceToken: "device-token" });
      assert.equal(lines.some((line) => line.includes("Connected a@example.com")), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write a token when Google never links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-google-"));
    const path = join(dir, "google.json");
    let saved = 0;
    try {
      await assert.rejects(
        () =>
          linkGoogle({
            googleUrl: "https://google.example",
            credentialsPath: path,
            timeoutMs: 0,
            sleep: async () => {
              throw new Error("should not sleep");
            },
            log: () => undefined,
            open: () => undefined,
            saveAccount: () => {
              saved += 1;
            },
            fetchImpl: async (input) => {
              if (String(input).endsWith("/v1/devices")) {
                return Response.json({ deviceToken: "device-token", startUrl: "https://google.example/login?state=abc" });
              }
              return Response.json({ linked: false, email: null });
            },
          }),
        /Timed out waiting for Google/,
      );
      assert.equal(existsSync(path), false);
      assert.equal(saved, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps cursors for the same mailbox and clears them for another", () => {
    const db = openDatabase(":memory:");
    try {
      const accounts = new SqliteAccountStore(db);
      const connectedAt = new Date("2026-11-05T11:00:00.000Z");
      accounts.saveLogin({ email: "a@example.com", connectedAt });
      accounts.saveGmailHistory("history-1");
      accounts.saveCalendarToken("calendar-1");
      accounts.saveLogin({ email: "a@example.com", connectedAt });
      assert.equal(accounts.load()?.gmailHistoryId, "history-1");
      assert.equal(accounts.load()?.calendarSyncToken, "calendar-1");
      accounts.saveLogin({ email: "b@example.com", connectedAt });
      assert.equal(accounts.load()?.email, "b@example.com");
      assert.equal(accounts.load()?.gmailHistoryId, null);
      assert.equal(accounts.load()?.calendarSyncToken, null);
      assert.equal(storedToken(db), "");
    } finally {
      db.close();
    }
  });

  it("reuses an access token until the worker is asked again", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      seen.push(url);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer device-token");
      const forced = url.includes("force=1");
      return Response.json({
        access_token: forced ? "second" : "first",
        expiry: "2026-11-06T02:00:00.000Z",
      });
    };
    const authorizer = createAuthorizer({
      googleUrl: "https://google.example/",
      deviceToken: "device-token",
      fetchImpl,
      now: () => new Date("2026-11-06T01:00:00.000Z"),
    });
    assert.equal(await authorizer.accessToken(), "first");
    assert.equal(await authorizer.accessToken(), "first");
    assert.equal(await authorizer.accessToken(true), "second");
    assert.deepEqual(seen, [
      "https://google.example/v1/access-token",
      "https://google.example/v1/access-token?force=1",
    ]);
    assert.equal(googleEndpoint("https://google.example/", "/v1/access-token"), "https://google.example/v1/access-token");
  });

  it("repeats the expired-login message from the worker", async () => {
    const authorizer = createAuthorizer({
      googleUrl: "https://google.example",
      deviceToken: "device-token",
      fetchImpl: async () => Response.json({ error: "Google login expired. Run npm run login." }, { status: 401 }),
      now: () => new Date("2026-11-06T01:00:00.000Z"),
    });
    await assert.rejects(() => authorizer.accessToken(), /Google login expired\. Run npm run login\./);
  });
});

function storedToken(db: DatabaseSync): string {
  const row = db.prepare("SELECT token_json FROM google_account WHERE id = 1").get() as { token_json: string };
  return row.token_json;
}
