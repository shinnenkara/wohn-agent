import { spawn } from "node:child_process";
import { systemClock } from "../adapters/clock/system-clock.js";
import { loadGoogleConfig } from "../adapters/config/google-env.js";
import { startLoopback, randomOAuthState } from "../adapters/google/loopback.js";
import { authorizationUrl, exchangeAuthCode } from "../adapters/google/oauth.js";
import { SqliteAccountStore } from "../adapters/sqlite/account-store.js";
import { openDatabase } from "../adapters/sqlite/database.js";

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  const state = randomOAuthState();
  const loop = await startLoopback(state);
  const url = authorizationUrl({
    clientId: config.clientId,
    redirectUri: loop.redirectUri,
    state,
  });
  openBrowser(url);
  process.stdout.write("Waiting for Google login in the browser.\n");
  try {
    const code = await loop.code;
    const token = await exchangeAuthCode(fetch, {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: loop.redirectUri,
      code,
      now: systemClock.now(),
    });
    const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!profile.ok) {
      throw new Error("could not read the gmail address");
    }
    const body = (await profile.json()) as { emailAddress?: string };
    if (!body.emailAddress) {
      throw new Error("gmail did not return an address");
    }
    const db = openDatabase(config.databasePath);
    try {
      new SqliteAccountStore(db).saveLogin({
        email: body.emailAddress,
        tokenJson: JSON.stringify(token),
        connectedAt: systemClock.now(),
      });
    } finally {
      db.close();
    }
    process.stdout.write(`Connected ${body.emailAddress}\n`);
  } finally {
    await loop.close();
  }
}

function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {
    process.stdout.write(`Open this URL to log in:\n${url}\n`);
  });
  child.unref();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
