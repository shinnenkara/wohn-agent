import type { ApplicantProfile } from "../../domain/applicant-profile.js";

export interface FormFillResult {
  pdf: Uint8Array | null;
  flagged: string[];
  unknown: string[];
  filled: string[];
}

export interface FormFiller {
  fill(pdf: Uint8Array, profile: ApplicantProfile): Promise<FormFillResult>;
}
