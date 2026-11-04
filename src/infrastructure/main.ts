import { loadRuntimeConfig } from "../adapters/config/env.js";
import { runAgentLoop } from "../application/run-agent-loop.js";
import { compose } from "./compose.js";

async function main(): Promise<void> {
  const app = await compose(loadRuntimeConfig());
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  app.control.start();
  try {
    await runAgentLoop(app.loop, controller.signal);
  } finally {
    await app.shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
