import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

export function randomOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export interface AuthCallback {
  redirectUri: string;
  code: Promise<string>;
  close(): Promise<void>;
}

export function startLoopback(expectedState: string): Promise<AuthCallback> {
  return new Promise((resolve, reject) => {
    let settle: ((code: string) => void) | null = null;
    let fail: ((error: Error) => void) | null = null;
    const code = new Promise<string>((resolveCode, rejectCode) => {
      settle = resolveCode;
      fail = rejectCode;
    });
    const server: Server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        response.writeHead(404);
        response.end();
        return;
      }
      const error = url.searchParams.get("error");
      const received = url.searchParams.get("state");
      const authCode = url.searchParams.get("code");
      if (error || received !== expectedState || !authCode) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Google login was not completed.");
        fail?.(new Error("google login was not completed"));
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        connection: "close",
      });
      response.end("<!doctype html><p>Login finished. You can close this window.</p>");
      settle?.(authCode);
    });
    const timer = setTimeout(() => {
      fail?.(new Error("google login timed out. Run npm run login again"));
      shutdown(server);
    }, LOGIN_TIMEOUT_MS);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not listen for the google login"));
        return;
      }
      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        code,
        async close() {
          clearTimeout(timer);
          await shutdown(server);
        },
      });
    });
  });
}

function shutdown(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((done) => {
    server.close(() => done());
  });
}
