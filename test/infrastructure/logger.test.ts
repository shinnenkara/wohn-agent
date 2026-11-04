import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "../../src/infrastructure/logger.js";

function capture(write: () => void): { stdout: string; stderr: string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    write();
    return { stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

describe("logger", () => {
  it("keeps the log sentence and drops sensitive fields in prod", () => {
    const logger = createLogger("prod");
    const logged = capture(() => {
      logger.error("chrome debugging port is unavailable", {
        message: "Chrome debugging port returned 500",
        phone: "+49 170 1234567",
        scoutId: "165686634",
      });
    });
    const line = JSON.parse(logged.stderr) as Record<string, string>;
    assert.equal(logged.stdout, "");
    assert.equal(line.level, "error");
    assert.equal(line.message, "chrome debugging port is unavailable");
    assert.equal(line.scoutId, "165686634");
    assert.equal("detail" in line, false);
    assert.equal("phone" in line, false);
    assert.equal(logged.stderr.includes("[redacted]"), false);
    assert.equal(logged.stderr.includes("500"), false);
    assert.equal(logged.stderr.includes("170"), false);
  });

  it("prints error causes and other sensitive fields in dev", () => {
    const logger = createLogger("dev");
    const logged = capture(() => {
      logger.error("chrome debugging port is unavailable", {
        message: "Chrome debugging port returned 500",
        phone: "+49 170 1234567",
      });
    });
    const line = JSON.parse(logged.stderr) as Record<string, string>;
    assert.equal(line.message, "chrome debugging port is unavailable");
    assert.equal(line.detail, "Chrome debugging port returned 500");
    assert.equal(line.phone, "+49 170 1234567");
  });

  it("still prints a dry-run preview in prod", () => {
    const logged = capture(() => {
      createLogger("prod").preview("application text\n");
    });
    assert.equal(logged.stdout, "application text\n");
  });
});
