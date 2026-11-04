import type { AgentStep } from "../domain/agent-event.js";
import { StepFailure } from "../domain/step-failure.js";
import type { FailureContext } from "./ports/failure-classifier.js";

export function toFailureContext(error: unknown, step: AgentStep): FailureContext {
  if (error instanceof StepFailure) {
    return {
      step: error.step,
      errorName: error.name,
      message: error.message,
      domSnippet: error.domSnippet,
    };
  }
  if (error instanceof Error) {
    return { step, errorName: error.name, message: error.message, domSnippet: "" };
  }
  return { step, errorName: "Error", message: String(error), domSnippet: "" };
}
