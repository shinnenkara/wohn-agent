import { DomainError } from "./domain-error.js";
import type { ListingStatus } from "./listing-status.js";

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
