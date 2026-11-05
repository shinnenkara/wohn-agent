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
  from: string;
  subject: string;
  sentAt: string;
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
}
