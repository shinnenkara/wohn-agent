import { DomainError } from "./domain-error.js";
import { isListingStatus, type ListingStatus } from "./listing-status.js";

export interface ExposeDetails {
  title: string;
  contactName: string | null;
  priceCold: number | null;
  rooms: number | null;
  areaSqm: number | null;
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
  isPlusOnly: boolean;
  status: ListingStatus;
  filterReason: string | null;
  errorCode: string | null;
  retryCount: number;
  discoveredAt: Date;
  appliedAt: Date | null;
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

  static discover(input: { scoutId: string; url: string; discoveredAt: Date }): Listing {
    const scoutId = input.scoutId.trim();
    if (!scoutId) {
      throw new DomainError("scoutId is required");
    }
    return new Listing({
      scoutId,
      url: input.url,
      title: null,
      salutation: null,
      priceCold: null,
      rooms: null,
      areaSqm: null,
      isPlusOnly: false,
      status: "DISCOVERED",
      filterReason: null,
      errorCode: null,
      retryCount: 0,
      discoveredAt: input.discoveredAt,
      appliedAt: null,
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
      priceCold: details.priceCold,
      rooms: details.rooms,
      areaSqm: details.areaSqm,
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

  private move(status: ListingStatus, patch: Partial<ListingData>): Listing {
    if (!TRANSITIONS[this.data.status].includes(status)) {
      throw new DomainError(`Cannot transition ${this.data.status} to ${status}`);
    }
    return new Listing({ ...this.data, ...patch, status });
  }
}
