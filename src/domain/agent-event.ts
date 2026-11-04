export const AGENT_STEPS = ["POLL", "EXTRACT", "FILL_FORM", "SUBMIT", "CAPTCHA"] as const;

export type AgentStep = (typeof AGENT_STEPS)[number];

export interface AgentEvent {
  scoutId: string | null;
  step: AgentStep;
  errorType: string | null;
  domSnippet: string | null;
  resolutionAction: string | null;
  createdAt: Date;
}
