import { DomainError } from "./domain-error.js";
import { isListingStatus, type ListingStatus } from "./listing-status.js";

export interface ExposeDetails {
  title: string;
  contactName: string | null;
  priceCold: number | null;
  priceWarm?: number | null;
  extraCosts?: number | null;
  deposit?: string | null;
  rooms: number | null;
  areaSqm: number | null;
  floor?: string | null;
  moveIn?: string | null;
  address?: string | null;
  description?: string | null;
  snapshot?: string | null;
  isPlusOnly: boolean;
}

export interface ListingData {
  scoutId: string;
  url: string;
  title: string | null;
  salutation: string | null;
  priceCold: number | null;
  rooms: number | null;
  areaSqm: number | null;
  address: string | null;
  priceWarm: number | null;
  extraCosts: number | null;
  deposit: string | null;
  floor: string | null;
  moveIn: string | null;
  description: string | null;
  snapshot: string | null;
  energyClass: string | null;
  previewImage: Uint8Array | null;
  isPlusOnly: boolean;
  status: ListingStatus;
  filterReason: string | null;
  errorCode: string | null;
  retryCount: number;
  discoveredAt: Date;
  appliedAt: Date | null;
  sentMessage: string;
}

const TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  DISCOVERED: ["FILTERED_OUT", "APPLYING", "MANUAL_REQUIRED"],
  APPLYING: ["APPLIED", "FAILED", "MANUAL_REQUIRED", "DISCOVERED"],
  FILTERED_OUT: [],
  APPLIED: [],
  FAILED: [],
  MANUAL_REQUIRED: [],
};

export class Listing {
  private constructor(private readonly data: ListingData) {}

  static discover(input: {
    scoutId: string;
    url: string;
    discoveredAt: Date;
    title?: string | null;
    priceCold?: number | null;
    priceWarm?: number | null;
    rooms?: number | null;
    areaSqm?: number | null;
    address?: string | null;
    energyClass?: string | null;
    previewImage?: Uint8Array | null;
  }): Listing {
    const scoutId = input.scoutId.trim();
    if (!scoutId) {
      throw new DomainError("scoutId is required");
    }
    return new Listing({
      scoutId,
      url: input.url,
      title: textOrNull(input.title, 300),
      salutation: null,
      priceCold: amountOrNull(input.priceCold),
      rooms: amountOrNull(input.rooms),
      areaSqm: amountOrNull(input.areaSqm),
      address: textOrNull(input.address, 200),
      priceWarm: amountOrNull(input.priceWarm),
      extraCosts: null,
      deposit: null,
      floor: null,
      moveIn: null,
      description: null,
      snapshot: null,
      energyClass: energyOrNull(input.energyClass),
      previewImage: imageOrNull(input.previewImage),
      isPlusOnly: false,
      status: "DISCOVERED",
      filterReason: null,
      errorCode: null,
      retryCount: 0,
      discoveredAt: input.discoveredAt,
      appliedAt: null,
      sentMessage: "",
    });
  }

  static rehydrate(data: ListingData): Listing {
    if (!isListingStatus(data.status)) {
      throw new DomainError(`Unknown listing status ${String(data.status)}`);
    }
    return new Listing({ ...data });
  }

  get scoutId(): string {
    return this.data.scoutId;
  }

  get url(): string {
    return this.data.url;
  }

  get title(): string | null {
    return this.data.title;
  }

  get salutation(): string | null {
    return this.data.salutation;
  }

  get priceCold(): number | null {
    return this.data.priceCold;
  }

  get rooms(): number | null {
    return this.data.rooms;
  }

  get areaSqm(): number | null {
    return this.data.areaSqm;
  }

  get address(): string | null {
    return this.data.address;
  }

  get priceWarm(): number | null {
    return this.data.priceWarm;
  }

  get extraCosts(): number | null {
    return this.data.extraCosts;
  }

  get deposit(): string | null {
    return this.data.deposit;
  }

  get floor(): string | null {
    return this.data.floor;
  }

  get moveIn(): string | null {
    return this.data.moveIn;
  }

  get description(): string | null {
    return this.data.description;
  }

  get snapshot(): string | null {
    return this.data.snapshot;
  }

  get energyClass(): string | null {
    return this.data.energyClass;
  }

  get previewImage(): Uint8Array | null {
    return this.data.previewImage;
  }

  get isPlusOnly(): boolean {
    return this.data.isPlusOnly;
  }

  get status(): ListingStatus {
    return this.data.status;
  }

  get filterReason(): string | null {
    return this.data.filterReason;
  }

  get errorCode(): string | null {
    return this.data.errorCode;
  }

  get retryCount(): number {
    return this.data.retryCount;
  }

  get discoveredAt(): Date {
    return this.data.discoveredAt;
  }

  get appliedAt(): Date | null {
    return this.data.appliedAt;
  }

  get sentMessage(): string {
    return this.data.sentMessage;
  }

  toData(): ListingData {
    return { ...this.data };
  }

  withDetails(details: ExposeDetails): Listing {
    if (this.data.status !== "DISCOVERED" && this.data.status !== "APPLYING") {
      throw new DomainError(`Cannot update details from ${this.data.status}`);
    }
    return new Listing({
      ...this.data,
      title: details.title,
      salutation: details.contactName,
      priceCold: details.priceCold ?? this.data.priceCold,
      rooms: details.rooms ?? this.data.rooms,
      areaSqm: details.areaSqm ?? this.data.areaSqm,
      address: details.address ?? this.data.address,
      priceWarm: details.priceWarm ?? this.data.priceWarm,
      extraCosts: details.extraCosts ?? null,
      deposit: details.deposit ?? null,
      floor: details.floor ?? null,
      moveIn: details.moveIn ?? null,
      description: details.description ?? null,
      snapshot: details.snapshot ?? null,
      isPlusOnly: details.isPlusOnly,
    });
  }

  startApplying(): Listing {
    return this.move("APPLYING", {});
  }

  filterOut(reason: string): Listing {
    return this.move("FILTERED_OUT", { filterReason: reason });
  }

  requireManual(reason: string, errorCode: string): Listing {
    return this.move("MANUAL_REQUIRED", { filterReason: reason, errorCode });
  }

  markFailed(errorCode: string): Listing {
    return this.move("FAILED", {
      errorCode,
      retryCount: this.data.retryCount + 1,
    });
  }

  markApplied(appliedAt: Date): Listing {
    return this.move("APPLIED", { appliedAt, errorCode: null });
  }

  releaseForRetry(errorCode: string): Listing {
    return this.move("DISCOVERED", {
      errorCode,
      retryCount: this.data.retryCount + 1,
    });
  }

  requeue(errorCode: string): Listing {
    return this.move("DISCOVERED", { errorCode });
  }

  releaseUnsent(): Listing {
    return this.move("DISCOVERED", { errorCode: null });
  }

  withSentMessage(message: string): Listing {
    return new Listing({ ...this.data, sentMessage: message });
  }

  private move(status: ListingStatus, patch: Partial<ListingData>): Listing {
    if (!TRANSITIONS[this.data.status].includes(status)) {
      throw new DomainError(`Cannot transition ${this.data.status} to ${status}`);
    }
    return new Listing({ ...this.data, ...patch, status });
  }
}

export function lacksExposeFacts(facts: {
  title: string | null;
  address: string | null;
  priceCold: number | null;
  priceWarm: number | null;
  rooms: number | null;
  areaSqm: number | null;
}): boolean {
  return (
    !facts.title &&
    !facts.address &&
    facts.priceCold === null &&
    facts.priceWarm === null &&
    facts.rooms === null &&
    facts.areaSqm === null
  );
}

function textOrNull(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

function amountOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function energyOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase() ?? "";
  return /^[A-H]\+?$/.test(trimmed) ? trimmed : null;
}

function imageOrNull(value: Uint8Array | null | undefined): Uint8Array | null {
  if (!value || value.byteLength === 0) {
    return null;
  }
  return new Uint8Array(value);
}
