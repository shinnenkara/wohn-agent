import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export const GOOGLE_CREDENTIALS_PATH = "data/google.json";

export interface GoogleCredentials {
  deviceToken: string;
}

const GoogleFileSchema = z.strictObject({
  deviceToken: z.string().min(1),
});

export function loadGoogleCredentials(path: string): GoogleCredentials | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = GoogleFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function googleEndpoint(googleUrl: string, path: string): string {
  const url = new URL(googleUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}
