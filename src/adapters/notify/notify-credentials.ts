import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const NOTIFY_CREDENTIALS_PATH = "data/notify.json";

export interface NotifyCredentials {
  deviceToken: string;
}

const NotifyFileSchema = z.strictObject({
  deviceToken: z.string().min(1),
});

export function loadNotifyCredentials(path: string): NotifyCredentials | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = NotifyFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
