import type { FormData, ProfileField } from "../../domain/applicant-profile.js";
import type { CaptchaSignal } from "../../domain/captcha-signal.js";
import type { ActionMethod } from "../../domain/selector-cache-entry.js";

export interface SessionStatus {
  loggedIn: boolean;
}

export interface CardRef {
  scoutId: string;
  title?: string | null;
  priceCold?: number | null;
  priceWarm?: number | null;
  rooms?: number | null;
  areaSqm?: number | null;
  energyClass?: string | null;
  address?: string | null;
  image?: Uint8Array | null;
}

export interface ExposeFacts {
  title: string;
  contactName: string | null;
  description: string;
  priceCold: number | null;
  priceWarm: number | null;
  extraCosts: number | null;
  deposit: string | null;
  rooms: number | null;
  areaSqm: number | null;
  floor: string | null;
  moveIn: string | null;
  address: string | null;
  snapshot: string;
  isPlusOnly: boolean;
  externalPortal: boolean;
}

export interface CachedSelector {
  selector: string;
  method: ActionMethod;
}

export interface ObservedAction {
  instruction: string;
  selector: string;
  method: ActionMethod;
}

export interface FillFieldsResult {
  requiresFileUpload: boolean;
  unfilledRequired: boolean;
}

export interface SubmitCheck {
  confirmed: boolean;
  bookmarked: boolean | null;
  validationErrors: string[];
}

export interface BrowserSession {
  assertReachable(): Promise<void>;
  ensureLoggedIn(): Promise<SessionStatus>;
  goto(url: string): Promise<void>;
  currentUrl(): Promise<string>;
  detectCaptcha(): Promise<CaptchaSignal | null>;
  readTitle(): Promise<string>;
  extractCards(): Promise<CardRef[]>;
  extractExpose(): Promise<ExposeFacts>;
  readContactName(): Promise<string | null>;
  openContact(cached: CachedSelector | null): Promise<ObservedAction>;
  fillRequiredFields(variables: FormData): Promise<FillFieldsResult>;
  fillFields(fields: readonly ProfileField[], variables: FormData): Promise<void>;
  locateSubmit(cached: CachedSelector | null): Promise<ObservedAction>;
  fillMessage(text: string, cached: CachedSelector | null): Promise<ObservedAction>;
  clearMessage(): Promise<void>;
  submit(selector: string): Promise<SubmitCheck>;
  closePopup(): Promise<void>;
  reload(): Promise<void>;
  clickSimpleCheckboxCaptcha(): Promise<boolean>;
  disconnect(): Promise<void>;
}
