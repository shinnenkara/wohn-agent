import { pathToFileURL } from "node:url";
import { loadGoogleConfig } from "../adapters/config/google-env.js";
import { composeConsole } from "./compose-console.js";
import { runConsoleLoop, stdinKeys } from "./console-loop.js";

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const app = composeConsole(loadGoogleConfig());
  try {
    const keys = stdinKeys();
    try {
      await runConsoleLoop(app.session, {
        write(frame) {
          process.stdout.write(`\x1b[2J\x1b[H${frame}`);
        },
        bell() {
          process.stdout.write("\x07");
        },
        nextKey: (timeoutMs) => keys.nextKey(timeoutMs),
      });
    } finally {
      keys.close();
    }
  } finally {
    app.shutdown();
  }
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
