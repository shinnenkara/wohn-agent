import type { AgentStep } from "../../domain/agent-event.js";
import type { FailureType } from "../../domain/failure-type.js";

export interface FailureContext {
  step: AgentStep;
  errorName: string;
  message: string;
  domSnippet: string;
}

export interface FailureClassifier {
  classify(context: FailureContext): Promise<FailureType>;
}
