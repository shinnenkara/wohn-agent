import type { ApplyDependencies } from "../src/application/apply-to-listing.js";
import type { InspectDependencies } from "../src/application/inspect-listing.js";
import type {
  BrowserSession,
  CachedSelector,
  CardRef,
  ExposeFacts,
  FillFieldsResult,
  ObservedAction,
  SubmitCheck,
} from "../src/application/ports/browser-session.js";
import type { Clock } from "../src/application/ports/clock.js";
import type { ControlChannel } from "../src/application/ports/control-channel.js";
import type { EventLog } from "../src/application/ports/event-log.js";
import type { FailureClassifier, FailureContext } from "../src/application/ports/failure-classifier.js";
import type { ListingRepository } from "../src/application/ports/listing-repository.js";
import type { Logger } from "../src/application/ports/logger.js";
import type { Alert, Notifier } from "../src/application/ports/notifier.js";
import type { SelectorCache } from "../src/application/ports/selector-cache.js";
import type { LoopDependencies } from "../src/application/run-agent-loop.js";
import type { ApplicantProfile, ProfileField } from "../src/domain/applicant-profile.js";
import { CaptchaEncountered, type CaptchaSignal } from "../src/domain/captcha-signal.js";
import { Listing } from "../src/domain/listing.js";
import type { ListingStatus } from "../src/domain/listing-status.js";
import type { AgentEvent } from "../src/domain/agent-event.js";
import type { SelectorCacheEntry } from "../src/domain/selector-cache-entry.js";
import type { RandomSource } from "../src/domain/timing.js";
import { classifyByRules } from "../src/adapters/stagehand/classify-by-rules.js";

export const zeroRandom: RandomSource = { next: () => 0 };

export function sampleProfile(patch?: Partial<ApplicantProfile>): ApplicantProfile {
  return {
    searchUrls: ["https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten"],
    blacklistKeywords: ["tauschwohnung", "wohnungstausch", "nur tausch", "wbs erforderlich", "wbs-schein"],
    messageTemplate: "Sehr geehrte(r) {{contact_name}}, Interesse an {{title}}. Tel +49 170 0000000",
    formData: {
      salutation: "Herr",
      firstName: "Max",
      lastName: "Mustermann",
      phone: "+49 170 0000000",
      moveInDate: "ab sofort / flexibel",
      numberOfPersons: "1",
      hasPets: "Nein",
      employmentStatus: "Angestellt (unbefristet)",
      monthlyNetIncome: "4200",
      schufaAvailable: true,
      sendApplicationPackage: true,
    },
    ...patch,
  };
}

export function sampleExpose(patch?: Partial<ExposeFacts>): ExposeFacts {
  return {
    title: "Helle 2-Zimmer-Wohnung",
    contactName: "Frau Müller",
    description: "Ruhige Wohnung mit Balkon.",
    priceCold: 1200,
    rooms: 2,
    areaSqm: 60,
    isPlusOnly: false,
    externalPortal: false,
    ...patch,
  };
}

export function discoverListing(scoutId = "165686634", at = new Date("2026-11-04T10:00:00.000Z")): Listing {
  return Listing.discover({
    scoutId,
    url: `https://www.immobilienscout24.de/expose/${scoutId}`,
    discoveredAt: at,
  });
}

export class FakeClock implements Clock {
  constructor(public current = new Date("2026-11-04T10:00:00.000Z")) {}

  now(): Date {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeLogger implements Logger {
  readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }

  error(message: string): void {
    this.messages.push(message);
  }

  readonly previews: string[] = [];

  preview(text: string): void {
    this.previews.push(text);
  }
}

export class InMemoryListings implements ListingRepository {
  readonly rows = new Map<string, Listing>();

  findById(scoutId: string): Listing | null {
    return this.rows.get(scoutId) ?? null;
  }

  findExistingIds(ids: readonly string[]): Set<string> {
    return new Set(ids.filter((id) => this.rows.has(id)));
  }

  insertAll(listings: readonly Listing[]): void {
    for (const listing of listings) {
      if (!this.rows.has(listing.scoutId)) {
        this.rows.set(listing.scoutId, listing);
      }
    }
  }

  save(listing: Listing): void {
    this.rows.set(listing.scoutId, listing);
  }

  listByStatus(status: ListingStatus): Listing[] {
    return [...this.rows.values()].filter((listing) => listing.status === status);
  }

  resetApplyingToDiscovered(): number {
    let count = 0;
    for (const [id, listing] of this.rows) {
      if (listing.status === "APPLYING") {
        this.rows.set(id, Listing.rehydrate({ ...listing.toData(), status: "DISCOVERED" }));
        count += 1;
      }
    }
    return count;
  }
}

export class InMemorySelectors implements SelectorCache {
  readonly entries = new Map<string, SelectorCacheEntry>();
  readonly invalidated: string[] = [];

  get(actionKey: string): SelectorCacheEntry | null {
    return this.entries.get(actionKey) ?? null;
  }

  upsert(entry: SelectorCacheEntry): void {
    this.entries.set(entry.actionKey, entry);
  }

  invalidate(actionKey: string): void {
    this.invalidated.push(actionKey);
    this.entries.delete(actionKey);
  }

  recordFailure(actionKey: string): void {
    const current = this.entries.get(actionKey);
    if (!current) {
      return;
    }
    this.entries.set(actionKey, { ...current, failCount: current.failCount + 1 });
  }
}

export class InMemoryEvents implements EventLog {
  readonly events: AgentEvent[] = [];

  append(event: AgentEvent): void {
    this.events.push(event);
  }
}

export class FakeNotifier implements Notifier {
  readonly alerts: Alert[] = [];

  async notify(alert: Alert): Promise<void> {
    this.alerts.push(alert);
  }
}

export class FakeControl implements ControlChannel {
  resume = false;
  started = false;
  stopped = false;

  start(): void {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  resumeRequested(): boolean {
    return this.resume;
  }

  consumeResume(): boolean {
    if (!this.resume) {
      return false;
    }
    this.resume = false;
    return true;
  }
}

export class RecordingClassifier implements FailureClassifier {
  readonly contexts: FailureContext[] = [];

  async classify(context: FailureContext) {
    this.contexts.push(context);
    const ruled = classifyByRules(context);
    if (!ruled) {
      throw new Error(`unclassified ${context.errorName}`);
    }
    return ruled;
  }
}

export class FakeBrowser implements BrowserSession {
  loggedIn = true;
  reachable = true;
  title = "Wohnung mieten in Berlin";
  cards: CardRef[] = [];
  expose = sampleExpose();
  fileUpload = false;
  captchaQueue: Array<CaptchaSignal | null> = [];
  throwOnGoto: CaptchaSignal | null = null;
  sessionCaptcha: CaptchaSignal | null = null;
  openErrors: unknown[] = [];
  submitErrors: unknown[] = [];
  urls: string[] = [];
  messages: string[] = [];
  filledFields: ProfileField[][] = [];
  submitSelectors: string[] = [];
  openCalls = 0;
  locateCalls = 0;
  closePopups = 0;
  reloads = 0;
  checkboxClicks = 0;
  clears = 0;
  ensureCalls = 0;
  private lastUrl = "";

  async assertReachable(): Promise<void> {
    if (!this.reachable) {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9222");
    }
  }

  async ensureLoggedIn() {
    this.ensureCalls += 1;
    if (this.sessionCaptcha) {
      throw new CaptchaEncountered(this.sessionCaptcha);
    }
    return { loggedIn: this.loggedIn };
  }

  async goto(url: string): Promise<void> {
    this.urls.push(url);
    this.lastUrl = url;
    if (this.throwOnGoto) {
      throw new CaptchaEncountered(this.throwOnGoto);
    }
  }

  async currentUrl(): Promise<string> {
    return this.lastUrl;
  }

  async detectCaptcha(): Promise<CaptchaSignal | null> {
    if (this.captchaQueue.length === 0) {
      return null;
    }
    return this.captchaQueue.shift() ?? null;
  }

  async readTitle(): Promise<string> {
    return this.title;
  }

  async extractCards(): Promise<CardRef[]> {
    return this.cards;
  }

  async extractExpose(): Promise<ExposeFacts> {
    return this.expose;
  }

  async openContact(cached: CachedSelector | null): Promise<ObservedAction> {
    this.openCalls += 1;
    void cached;
    const error = this.openErrors.shift();
    if (error) {
      throw error;
    }
    return { instruction: "find the button to send a message or contact the landlord", selector: "#contact", method: "click" };
  }

  async fillRequiredFields(): Promise<FillFieldsResult> {
    return { requiresFileUpload: this.fileUpload };
  }

  async fillFields(fields: readonly ProfileField[]): Promise<void> {
    this.filledFields.push([...fields]);
  }

  async locateSubmit(): Promise<ObservedAction> {
    this.locateCalls += 1;
    return { instruction: "find the submit button inside the contact form", selector: "#send", method: "click" };
  }

  async fillMessage(text: string): Promise<ObservedAction> {
    this.messages.push(text);
    return { instruction: "find the message textarea in the contact form", selector: "form textarea", method: "fill" };
  }

  async clearMessage(): Promise<void> {
    this.clears += 1;
  }

  async submit(selector: string): Promise<SubmitCheck> {
    this.submitSelectors.push(selector);
    const error = this.submitErrors.shift();
    if (error) {
      throw error;
    }
    return { confirmed: true, bookmarked: true, validationErrors: [] };
  }

  async closePopup(): Promise<void> {
    this.closePopups += 1;
  }

  async reload(): Promise<void> {
    this.reloads += 1;
  }

  async clickSimpleCheckboxCaptcha(): Promise<boolean> {
    this.checkboxClicks += 1;
    return true;
  }

  async disconnect(): Promise<void> {}
}

export interface Harness {
  clock: FakeClock;
  logger: FakeLogger;
  listings: InMemoryListings;
  selectors: InMemorySelectors;
  events: InMemoryEvents;
  notifier: FakeNotifier;
  control: FakeControl;
  classifier: RecordingClassifier;
  browser: FakeBrowser;
  profile: ApplicantProfile;
  loop: LoopDependencies;
  apply: ApplyDependencies;
  inspect: InspectDependencies;
}

export function createHarness(): Harness {
  const clock = new FakeClock();
  const logger = new FakeLogger();
  const listings = new InMemoryListings();
  const selectors = new InMemorySelectors();
  const events = new InMemoryEvents();
  const notifier = new FakeNotifier();
  const control = new FakeControl();
  const classifier = new RecordingClassifier();
  const browser = new FakeBrowser();
  const profile = sampleProfile();
  const apply: ApplyDependencies = {
    browser,
    listings,
    selectors,
    events,
    classifier,
    notifier,
    logger,
    clock,
    dryRun: false,
  };
  const inspect: InspectDependencies = {
    browser,
    listings,
    events,
    classifier,
    notifier,
    logger,
    clock,
    profile,
  };
  const loop: LoopDependencies = {
    ...apply,
    control,
    random: zeroRandom,
    profile,
    maxApplicationsPerCycle: 5,
    overnightRun: false,
  };
  return { clock, logger, listings, selectors, events, notifier, control, classifier, browser, profile, loop, apply, inspect };
}
