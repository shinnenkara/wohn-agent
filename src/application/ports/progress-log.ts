import type { MailCandidate } from "../../domain/mail-link.js";
import type { FunnelStage, ProgressSource } from "../../domain/progress.js";

export interface ProgressNote {
  scoutId: string;
  next: FunnelStage;
  source: ProgressSource;
  evidenceId: string | null;
  at: Date;
}

export interface ProgressTransitionRow {
  scoutId: string;
  fromStage: FunnelStage;
  toStage: FunnelStage;
  source: ProgressSource;
  evidenceId: string | null;
  createdAt: Date;
}

export interface StageRow {
  scoutId: string;
  stage: FunnelStage;
}

export interface ApartmentMail {
  id: string;
  url: string;
  from: string;
  subject: string;
  sentAt: string;
  intent: string;
  relation: string;
  draft: string;
  altDraft: string;
  composeUrl: string;
  altComposeUrl: string;
  cleanText: string;
  intents: string[];
  riskLevel: string;
  redFlags: string[];
  documents: string[];
  slots: string[];
  linkUrl: string;
  linkHost: string;
  linksAreText: boolean;
}

export interface ApartmentTopic {
  topic: string;
  relation: string;
  count: number;
}

export interface ApartmentViewing {
  id: string;
  title: string;
  start: string;
  place: string;
}

export interface ApartmentCard {
  scoutId: string;
  stage: FunnelStage;
  title: string | null;
  url: string;
  opened: boolean;
  address: string | null;
  priceCold: number | null;
  priceWarm: number | null;
  extraCosts: number | null;
  deposit: string | null;
  rooms: number | null;
  areaSqm: number | null;
  floor: string | null;
  moveIn: string | null;
  description: string | null;
  energyClass: string | null;
  hasImage: boolean;
  refreshState: "queued" | "failed" | null;
  refreshDetail: string | null;
  discoveredAt: string | null;
  topic: ApartmentTopic | null;
  mails: ApartmentMail[];
  viewings: ApartmentViewing[];
}

export interface ProgressLog {
  stageOf(scoutId: string): FunnelStage | null;
  note(input: ProgressNote): boolean;
  backfillListings(at: Date): number;
  listStages(): StageRow[];
  listTransitions(): ProgressTransitionRow[];
  listApartments(stage: FunnelStage): ApartmentCard[];
  openApplications(since: Date): MailCandidate[];
}
