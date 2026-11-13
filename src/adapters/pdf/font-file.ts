import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let cached: Uint8Array | null = null;

export function notoSansBytes(): Uint8Array {
  if (!cached) {
    cached = new Uint8Array(readFileSync(fileURLToPath(new URL("./NotoSans-Regular.ttf", import.meta.url))));
  }
  return cached;
}
