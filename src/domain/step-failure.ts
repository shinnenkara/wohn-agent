import type { AgentStep } from "./agent-event.js";

export class StepFailure extends Error {
  readonly step: AgentStep;
  readonly domSnippet: string;

  constructor(
    step: AgentStep,
    message: string,
    options?: { name?: string; domSnippet?: string; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.step = step;
    this.domSnippet = options?.domSnippet ?? "";
    this.name = options?.name ?? "StepFailure";
  }
}
