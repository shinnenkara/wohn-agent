import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchBlacklist } from "../../src/domain/blacklist.js";
import { CaptchaBreaker } from "../../src/domain/circuit-breaker.js";
import {
  classifyCaptchaWidgets,
  titleIndicatesCaptcha,
  titleIsClearOfCaptcha,
  type CaptchaWidget,
} from "../../src/domain/captcha-signal.js";
import { DomainError } from "../../src/domain/domain-error.js";
import { Listing } from "../../src/domain/listing.js";
import { renderMessage } from "../../src/domain/message-template.js";
import { decideRecovery, emptyRecoveryCounts } from "../../src/domain/recovery-policy.js";
import {
  betweenListingDelayMs,
  captchaCooldownMs,
  isWithinActiveHours,
  msUntilActiveWindow,
  pollIntervalMs,
} from "../../src/domain/timing.js";
import { matchValidationFields } from "../../src/domain/validation-fields.js";
import { discoverListing } from "../fakes.js";

describe("listing status", () => {
  it("allows the application path and rejects terminal reuse", () => {
    const discovered = discoverListing();
    const applying = discovered.startApplying();
    const applied = applying.markApplied(new Date("2026-11-04T12:00:00.000Z"));
    assert.equal(applied.status, "APPLIED");
    assert.equal(applied.appliedAt?.toISOString(), "2026-11-04T12:00:00.000Z");
    assert.throws(() => applied.startApplying(), DomainError);
    assert.throws(() => discovered.markApplied(new Date()), DomainError);
    assert.throws(() => discovered.markFailed("SELECTOR_STALE"), DomainError);
  });

  it("returns to discovered for a retry and requeues a captcha without a penalty", () => {
    const applying = discoverListing().startApplying();
    const retried = applying.releaseForRetry("SELECTOR_STALE");
    assert.equal(retried.status, "DISCOVERED");
    assert.equal(retried.retryCount, 1);
    assert.equal(retried.errorCode, "SELECTOR_STALE");
    const paused = applying.requeue("CAPTCHA_HIT");
    assert.equal(paused.status, "DISCOVERED");
    assert.equal(paused.retryCount, 0);
    assert.equal(paused.errorCode, "CAPTCHA_HIT");
    const unsent = applying.releaseUnsent();
    assert.equal(unsent.status, "DISCOVERED");
    assert.equal(unsent.retryCount, 0);
    assert.equal(unsent.errorCode, null);
  });

  it("filters and stores expose details only before a terminal status", () => {
    const filtered = discoverListing()
      .withDetails({
        title: "Tauschwohnung",
        contactName: null,
        priceCold: 900,
        rooms: 2,
        areaSqm: 55,
        isPlusOnly: true,
      })
      .filterOut("Keyword match: tauschwohnung");
    assert.equal(filtered.status, "FILTERED_OUT");
    assert.equal(filtered.title, "Tauschwohnung");
    assert.equal(filtered.isPlusOnly, true);
    assert.throws(() => filtered.withDetails({
      title: "x",
      contactName: null,
      priceCold: null,
      rooms: null,
      areaSqm: null,
      isPlusOnly: false,
    }), DomainError);
  });
});

describe("message, blacklist, and validation", () => {
  it("falls back when the contact name is missing", () => {
    const rendered = renderMessage("Hallo {{contact_name}} zu {{title}}", "  ", "Altbau");
    assert.equal(rendered, "Hallo Damen und Herren zu Altbau");
  });

  it("matches blacklist keywords without changing their spelling", () => {
    assert.equal(matchBlacklist(["WBS erforderlich"], "Wohnung", "Nur mit WBS erforderlich"), "WBS erforderlich");
    assert.equal(matchBlacklist(["tauschwohnung"], "Helle Wohnung", "Balkon"), null);
  });

  it("maps German validation text onto profile fields", () => {
    assert.deepEqual(matchValidationFields("Einkommen ist ein Pflichtfeld"), ["monthlyNetIncome"]);
    assert.deepEqual(matchValidationFields("Bitte Haustiere angeben"), ["hasPets"]);
    assert.deepEqual(matchValidationFields("Unbekanntes Feld"), []);
  });
});

describe("recovery policy", () => {
  const counts = emptyRecoveryCounts();

  it("closes a popup twice, reloads once, then fails", () => {
    assert.deepEqual(decideRecovery("POPUP_BLOCKED", counts).actions, ["close_popup"]);
    assert.equal(decideRecovery("POPUP_BLOCKED", { ...counts, popupCloses: 2 }).actions[0], "reload_page");
    assert.equal(
      decideRecovery("POPUP_BLOCKED", { ...counts, popupCloses: 2, reloads: 1 }).terminal,
      "FAILED",
    );
  });

  it("rediscovers a stale selector once", () => {
    assert.deepEqual(decideRecovery("SELECTOR_STALE", counts).actions, [
      "invalidate_selector",
      "rediscover_selector",
    ]);
    assert.equal(decideRecovery("SELECTOR_STALE", { ...counts, selectorRediscovers: 1 }).terminal, "FAILED");
  });

  it("resubmits validation twice and then asks for a person", () => {
    assert.equal(decideRecovery("VALIDATION_ERROR", counts).terminal, null);
    assert.equal(
      decideRecovery("VALIDATION_ERROR", { ...counts, validationResubmits: 2 }).terminal,
      "MANUAL_REQUIRED",
    );
    assert.equal(decideRecovery("EXTERNAL_PORTAL", counts).terminal, "MANUAL_REQUIRED");
    assert.equal(decideRecovery("CAPTCHA_HIT", counts).terminal, "BREAKER");
  });
});

describe("captcha breaker and hours", () => {
  it("moves closed to half-open, then open, then closed", () => {
    const halfOpen = CaptchaBreaker.closed().recordDetection();
    assert.equal(halfOpen.state, "HALF_OPEN");
    assert.equal(halfOpen.recordCleared().state, "CLOSED");
    assert.equal(halfOpen.recordDetection().state, "OPEN");
    assert.equal(CaptchaBreaker.rehydrate("OPEN").recordCleared().state, "CLOSED");
  });

  it("recognizes the ImmoScout captcha title", () => {
    assert.equal(titleIndicatesCaptcha("Ich bin kein Roboter"), true);
    assert.equal(titleIsClearOfCaptcha(""), false);
    assert.equal(titleIsClearOfCaptcha("Wohnung mieten"), true);
  });

  it("ignores the hidden recaptcha frame embedded on a normal page", () => {
    const hidden = widget({
      src: "https://www.google.com/recaptcha/api2/aframe",
      visible: false,
    });
    assert.equal(classifyCaptchaWidgets([hidden]), null);
    assert.deepEqual(
      classifyCaptchaWidgets([
        widget({ src: "https://www.google.com/recaptcha/api2/anchor?k=abc", title: "reCAPTCHA", visible: true }),
      ]),
      { kind: "checkbox", detail: "recaptcha" },
    );
    assert.deepEqual(
      classifyCaptchaWidgets([
        widget({ src: "https://www.google.com/recaptcha/api2/bframe?k=abc", visible: true }),
      ]),
      { kind: "selector", detail: "recaptcha-challenge" },
    );
  });

  it("sleeps until 07:00 Berlin and jitters the poll interval", () => {
    assert.equal(msUntilActiveWindow(new Date("2026-11-04T05:30:00.000Z")), 30 * 60 * 1000);
    assert.equal(msUntilActiveWindow(new Date("2026-11-04T22:30:00.000Z")), 7.5 * 60 * 60 * 1000);
    assert.equal(msUntilActiveWindow(new Date("2026-07-04T04:30:00.000Z")), 30 * 60 * 1000);
    assert.equal(isWithinActiveHours(new Date("2026-11-04T06:00:00.000Z")), true);
    assert.equal(isWithinActiveHours(new Date("2026-11-04T22:00:00.000Z")), false);
    assert.equal(pollIntervalMs({ next: () => 0 }), 48_000);
    assert.equal(betweenListingDelayMs({ next: () => 0 }), 8_000);
    assert.equal(captchaCooldownMs({ next: () => 0 }), 90_000);
  });
});

function widget(overrides: Partial<CaptchaWidget>): CaptchaWidget {
  return {
    kind: "iframe",
    src: "",
    title: "",
    id: "",
    className: "",
    visible: true,
    ...overrides,
  };
}
