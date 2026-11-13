import { DomainError } from "./domain-error.js";
import type { ListingStatus } from "./listing-status.js";
import type { MailIntent } from "./mail-reply.js";

export const FUNNEL_STAGES = [
  "discovered",
  "filtered_out",
  "manual",
  "failed",
  "applied",
  "in_conversation",
  "viewing_offered",
  "scheduled",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const PROGRESS_SOURCES = ["apply", "mail", "calendar", "backfill"] as const;

export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

const RANK: Record<FunnelStage, number> = {
  discovered: 10,
  filtered_out: 20,
  manual: 20,
  failed: 20,
  applied: 30,
  in_conversation: 40,
  viewing_offered: 50,
  scheduled: 60,
};

const PARENT: Partial<Record<FunnelStage, FunnelStage>> = {
  filtered_out: "discovered",
  manual: "discovered",
  failed: "discovered",
  applied: "discovered",
  in_conversation: "applied",
  viewing_offered: "in_conversation",
  scheduled: "viewing_offered",
};

export function parentStage(stage: FunnelStage): FunnelStage | null {
  return PARENT[stage] ?? null;
}

export function stageBranch(stage: FunnelStage): FunnelStage[] {
  const children = new Map<FunnelStage, FunnelStage[]>();
  for (const item of FUNNEL_STAGES) {
    const parent = PARENT[item];
    if (!parent) {
      continue;
    }
    const list = children.get(parent);
    if (list) {
      list.push(item);
    } else {
      children.set(parent, [item]);
    }
  }
  const branch: FunnelStage[] = [];
  const walk = (current: FunnelStage) => {
    branch.push(current);
    for (const child of children.get(current) ?? []) {
      walk(child);
    }
  };
  walk(stage);
  return branch;
}

export interface AdvanceResult {
  stage: FunnelStage;
  from: FunnelStage | null;
  moved: boolean;
}

export function isFunnelStage(value: string): value is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}

export function assertFunnelStage(value: string): FunnelStage {
  if (!isFunnelStage(value)) {
    throw new DomainError(`Unknown funnel stage ${value}`);
  }
  return value;
}

export function advance(current: FunnelStage | null, next: FunnelStage): AdvanceResult {
  if (current === null) {
    return { stage: next, from: null, moved: true };
  }
  if (RANK[next] > RANK[current]) {
    return { stage: next, from: current, moved: true };
  }
  return { stage: current, from: current, moved: false };
}

export function funnelStageForListing(status: ListingStatus): FunnelStage {
  switch (status) {
    case "DISCOVERED":
    case "APPLYING":
      return "discovered";
    case "FILTERED_OUT":
      return "filtered_out";
    case "MANUAL_REQUIRED":
      return "manual";
    case "FAILED":
      return "failed";
    case "APPLIED":
      return "applied";
  }
}

export interface BackfillEntry {
  stage: FunnelStage;
  hop: { from: FunnelStage; to: FunnelStage } | null;
}

export function backfillEntry(status: ListingStatus): BackfillEntry {
  const stage = funnelStageForListing(status);
  if (stage === "discovered") {
    return { stage, hop: null };
  }
  return { stage, hop: { from: "discovered", to: stage } };
}

export const APPLICATION_OUTCOMES = [
  "open",
  "cancelled_by_us",
  "rejected",
  "offer_declined",
  "withdrawn",
] as const;

export type ApplicationOutcome = (typeof APPLICATION_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<ApplicationOutcome, string> = {
  open: "Open",
  cancelled_by_us: "Cancelled by us",
  rejected: "Rejected",
  offer_declined: "Offer declined",
  withdrawn: "Withdrawn",
};

const REOPEN_INTENTS = new Set<MailIntent>([
  "viewing_schedule",
  "viewing_confirm",
  "viewing_followup",
  "slot_cancelled",
  "contract_schedule",
  "contract_confirm",
  "contract_outcome",
]);

export function isApplicationOutcome(value: string): value is ApplicationOutcome {
  return (APPLICATION_OUTCOMES as readonly string[]).includes(value);
}

export function assertApplicationOutcome(value: string): ApplicationOutcome {
  if (!isApplicationOutcome(value)) {
    throw new DomainError(`Unknown application outcome ${value}`);
  }
  return value;
}

export function mailOutcome(input: {
  intent: MailIntent;
  codes: readonly string[];
}): ApplicationOutcome | "reopen" | null {
  if (input.codes.includes("REJECTION")) {
    return "rejected";
  }
  if (input.intent === "cancelled_by_us" || input.codes.includes("APPT_CANCELLED_BY_US")) {
    return "cancelled_by_us";
  }
  if (REOPEN_INTENTS.has(input.intent)) {
    return "reopen";
  }
  return null;
}

export function declineOutcome(intentCode: string): ApplicationOutcome | null {
  if (intentCode === "POST_VIEWING_INTEREST") {
    return "withdrawn";
  }
  if (intentCode === "CONTRACT_DRAFT_REVIEW") {
    return "offer_declined";
  }
  if (
    intentCode === "APPT_PROPOSAL" ||
    intentCode === "APPT_CONFIRMATION" ||
    intentCode === "CONTRACT_SIGNING_ARR" ||
    intentCode === "APPT_SLOT_CANCELLED"
  ) {
    return "cancelled_by_us";
  }
  return null;
}

export const STAGE_LABELS: Record<FunnelStage, string> = {
  discovered: "Discovered",
  filtered_out: "Filtered out",
  manual: "Manual",
  failed: "Failed",
  applied: "Applied",
  in_conversation: "In conversation",
  viewing_offered: "Viewing offered",
  scheduled: "Scheduled",
};
