import type { AppEnv } from "../adapters/config/env.js";
import type { Logger } from "../application/ports/logger.js";

const REDACTED = new Set([
  "phone",
  "monthlynetincome",
  "message",
  "token",
  "apikey",
  "authorization",
  "password",
]);

export function createLogger(appEnv: AppEnv = "prod"): Logger {
  return {
    info(message, fields) {
      write("info", message, fields, appEnv);
    },
    error(message, fields) {
      write("error", message, fields, appEnv);
    },
    preview(text) {
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    },
  };
}

function write(
  level: "info" | "error",
  message: string,
  fields: Record<string, string | number | boolean | null> | undefined,
  appEnv: AppEnv,
): void {
  const payload: Record<string, string | number | boolean | null> = { level, message };
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (appEnv === "prod" && REDACTED.has(key.toLowerCase())) {
      continue;
    }
    payload[key.toLowerCase() === "message" ? "detail" : key] = value;
  }
  const line = `${JSON.stringify(payload)}\n`;
  if (level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}
