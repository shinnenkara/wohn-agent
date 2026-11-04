import type { AgentEvent } from "../../domain/agent-event.js";

export interface EventLog {
  append(event: AgentEvent): void;
}
