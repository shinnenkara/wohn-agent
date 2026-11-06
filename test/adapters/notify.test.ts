import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TELEGRAM_OFF_MESSAGE, createNotifier } from "../../src/adapters/notify/create-notifier.js";
import { CAPTCHA_ALERT_TEXT, formatAlert } from "../../src/adapters/notify/format-alert.js";
import { linkNotify } from "../../src/infrastructure/link-notify.js";
import { LoggingNotifier } from "../../src/adapters/notify/logging-notifier.js";
import { loadNotifyCredentials } from "../../src/adapters/notify/notify-credentials.js";
import { RelayNotifier } from "../../src/adapters/notify/relay-notifier.js";
import type { Logger } from "../../src/application/ports/logger.js";

describe("notify", () => {
  it("logs the alert text", async () => {
    const lines: string[] = [];
    await new LoggingNotifier(logger(lines)).notify({ type: "CAPTCHA_OPEN" });
    assert.equal(lines[0], CAPTCHA_ALERT_TEXT);
    const draft = formatAlert({
      type: "MAIL_DRAFT",
      scoutId: "171599833",
      intent: "documents",
      body: "Gerne.",
      altBody: "",
      composeUrl: "https://mail.google.com/mail/?view=cm",
      altComposeUrl: "",
      messageUrl: "https://mail.google.com/mail/u/0/#all/m1",
    });
    assert.equal(draft.includes("Open in Gmail: https://mail.google.com/mail/?view=cm"), true);
    assert.equal(draft.includes("Message: https://mail.google.com/mail/u/0/#all/m1"), true);
  });

  it("posts linked alerts to the relay", async () => {
    let seen: { url: string; authorization: string | null; body: unknown } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      seen = {
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)),
      };
      return new Response(null, { status: 204 });
    };
    await new RelayNotifier("https://notify.example/", "secret-token", fetchImpl).notify({ type: "CAPTCHA_OPEN" });
    assert.equal(seen?.url, "https://notify.example/v1/alerts");
    assert.equal(seen?.authorization, "Bearer secret-token");
    assert.deepEqual(seen?.body, { type: "CAPTCHA_OPEN" });
    await assert.rejects(
      () => new RelayNotifier("https://notify.example", "secret-token", async () => new Response(null, { status: 401 })).notify({
        type: "SESSION_EXPIRED",
      }),
      /401/,
    );
  });

  it("stays on the console until a device token exists", async () => {
    const lines: string[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    };
    const quiet = createNotifier(logger(lines), "", null, fetchImpl);
    await quiet.notify({ type: "SESSION_EXPIRED" });
    assert.equal(calls, 0);
    assert.equal(lines.includes(TELEGRAM_OFF_MESSAGE), false);

    const off = createNotifier(logger(lines), "https://notify.example", null, fetchImpl);
    assert.equal(lines.includes(TELEGRAM_OFF_MESSAGE), true);
    await off.notify({ type: "SESSION_EXPIRED" });
    assert.equal(calls, 0);

    const linked = createNotifier(logger(lines), "https://notify.example", { deviceToken: "secret-token" }, fetchImpl);
    await linked.notify({ type: "SESSION_EXPIRED" });
    assert.equal(calls, 1);
  });

  it("reads a device token and ignores a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-notify-"));
    try {
      assert.equal(loadNotifyCredentials(join(dir, "missing.json")), null);
      const broken = join(dir, "broken.json");
      writeFileSync(broken, "{", "utf8");
      assert.equal(loadNotifyCredentials(broken), null);
      const path = join(dir, "notify.json");
      writeFileSync(path, `${JSON.stringify({ deviceToken: "secret-token" })}\n`, "utf8");
      assert.deepEqual(loadNotifyCredentials(path), { deviceToken: "secret-token" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the device token after Telegram links the chat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-link-"));
    const path = join(dir, "notify.json");
    const lines: string[] = [];
    let polls = 0;
    try {
      await linkNotify({
        notifyUrl: "https://notify.example",
        credentialsPath: path,
        timeoutMs: 5_000,
        pollMs: 1,
        sleep: async () => undefined,
        log: (line) => lines.push(line),
        fetchImpl: async (input, init) => {
          const url = String(input);
          if (url.endsWith("/v1/devices")) {
            assert.equal(init?.method, "POST");
            return Response.json({ deviceToken: "device-token", startUrl: "https://t.me/WohnAgentBot?start=abc" });
          }
          assert.equal(new Headers(init?.headers).get("authorization"), "Bearer device-token");
          polls += 1;
          return Response.json({ linked: polls >= 2 });
        },
      });
      assert.equal(lines.some((line) => line.includes("https://t.me/WohnAgentBot?start=abc")), true);
      assert.deepEqual(loadNotifyCredentials(path), { deviceToken: "device-token" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not write a token when Telegram never links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-link-"));
    const path = join(dir, "notify.json");
    try {
      await assert.rejects(
        () =>
          linkNotify({
            notifyUrl: "https://notify.example",
            credentialsPath: path,
            timeoutMs: 0,
            sleep: async () => {
              throw new Error("should not sleep");
            },
            log: () => undefined,
            fetchImpl: async (input) => {
              if (String(input).endsWith("/v1/devices")) {
                return Response.json({ deviceToken: "device-token", startUrl: "https://t.me/WohnAgentBot?start=abc" });
              }
              return Response.json({ linked: false });
            },
          }),
        /Timed out waiting for Telegram/,
      );
      assert.equal(existsSync(path), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function logger(lines: string[]): Logger {
  return {
    info(message) {
      lines.push(message);
    },
    error(message) {
      lines.push(message);
    },
    preview(text) {
      lines.push(text);
    },
  };
}
