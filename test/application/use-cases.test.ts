import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyToListing } from "../../src/application/apply-to-listing.js";
import { inspectListing } from "../../src/application/inspect-listing.js";
import { pollSearch } from "../../src/application/poll-search.js";
import { refreshExpose } from "../../src/application/refresh-expose.js";
import { runAgentLoop, runTick } from "../../src/application/run-agent-loop.js";
import { CaptchaBreaker } from "../../src/domain/circuit-breaker.js";
import { CaptchaEncountered } from "../../src/domain/captcha-signal.js";
import { Listing } from "../../src/domain/listing.js";
import { StepFailure } from "../../src/domain/step-failure.js";
import { createHarness, discoverListing, sampleExpose } from "../fakes.js";

function timeout(step: "FILL_FORM" | "SUBMIT" = "FILL_FORM"): StepFailure {
  return new StepFailure(step, "Timeout 3000ms exceeded", { name: "TimeoutError" });
}

describe("poll and inspect", () => {
  it("inserts only unseen expose ids", async () => {
    const harness = createHarness();
    harness.listings.save(discoverListing("111111"));
    harness.browser.cards = [{ scoutId: "111111" }, { scoutId: "222222" }];
    const created = await pollSearch(harness.loop, harness.profile.searchUrls[0] ?? "");
    assert.deepEqual(created.map((listing) => listing.scoutId), ["222222"]);
    assert.equal(harness.listings.findById("222222")?.url, "https://www.immobilienscout24.de/expose/222222");
  });

  it("stores search-card facts and fills only missing fields later", async () => {
    const harness = createHarness();
    harness.browser.cards = [
      {
        scoutId: "222222",
        title: "Großzügig wohnen: 3-Zimmer-Wohnung mit Terrasse",
        priceCold: 1595,
        rooms: 3,
        areaSqm: 70.69,
        energyClass: "A",
        address: "Robert-Stolz-Str. 5, Mörsenbroich, Düsseldorf",
      },
    ];
    const created = await pollSearch(harness.loop, harness.profile.searchUrls[0] ?? "");
    assert.equal(created[0]?.title, "Großzügig wohnen: 3-Zimmer-Wohnung mit Terrasse");
    assert.equal(created[0]?.priceCold, 1595);
    assert.equal(harness.listings.findById("222222")?.energyClass, "A");

    harness.listings.save(discoverListing("333333"));
    harness.browser.cards = [{ scoutId: "333333", title: "Filled later", priceCold: 800 }];
    await pollSearch(harness.loop, harness.profile.searchUrls[0] ?? "");
    assert.equal(harness.listings.findById("333333")?.title, "Filled later");
    assert.equal(harness.listings.findById("333333")?.priceCold, 800);

    const exposed = discoverListing("444444").withDetails({
      title: "Expose title",
      contactName: null,
      priceCold: 900,
      rooms: 2,
      areaSqm: 50,
      address: "Expose Str. 1",
      isPlusOnly: false,
    });
    harness.listings.save(exposed);
    harness.browser.cards = [{ scoutId: "444444", title: "Search title", priceCold: 1, address: "Other Str. 9" }];
    await pollSearch(harness.loop, harness.profile.searchUrls[0] ?? "");
    const kept = harness.listings.findById("444444");
    assert.equal(kept?.title, "Expose title");
    assert.equal(kept?.priceCold, 900);
    assert.equal(kept?.address, "Expose Str. 1");
    assert.equal(kept?.status, "DISCOVERED");
  });

  it("fills an empty expose without moving the funnel", async () => {
    const harness = createHarness();
    const listing = discoverListing("171641591");
    harness.listings.save(listing);
    harness.progress.note({
      scoutId: listing.scoutId,
      next: "discovered",
      source: "apply",
      evidenceId: listing.scoutId,
      at: harness.clock.now(),
    });
    harness.progress.note({
      scoutId: listing.scoutId,
      next: "applied",
      source: "mail",
      evidenceId: "1a1a73fb70962a18",
      at: harness.clock.now(),
    });
    harness.browser.expose = sampleExpose({ title: "From expose", snapshot: "The expose body" });
    assert.equal(await refreshExpose(harness.loop, listing), "filled");
    const stored = harness.listings.findById(listing.scoutId);
    assert.equal(stored?.title, "From expose");
    assert.equal(stored?.status, "DISCOVERED");
    assert.equal(stored?.snapshot, "The expose body");
    assert.equal(harness.progress.stageOf(listing.scoutId), "applied");
    assert.equal(harness.progress.listTransitions().length, 1);
    harness.browser.expose = sampleExpose({ title: "Other title" });
    assert.equal(await refreshExpose(harness.loop, stored ?? listing), "skipped");
    assert.equal(harness.listings.findById(listing.scoutId)?.title, "From expose");
  });

  it("leaves the listing untouched when the expose cannot be read", async () => {
    const harness = createHarness();
    const listing = discoverListing("171728408");
    harness.listings.save(listing);
    harness.browser.extractExpose = async () => {
      throw new Error("gone");
    };
    assert.equal(await refreshExpose(harness.loop, listing), "missing");
    assert.equal(harness.listings.findById(listing.scoutId)?.title, null);
    assert.equal(harness.listings.findById(listing.scoutId)?.status, "DISCOVERED");
  });

  it("filters a blacklisted listing before opening the contact form", async () => {
    const harness = createHarness();
    harness.browser.expose = sampleExpose({ description: "Nur als Tauschwohnung abzugeben" });
    const listing = discoverListing();
    harness.listings.save(listing);
    const result = await inspectListing(harness.inspect, listing);
    assert.equal(result.status, "FILTERED_OUT");
    assert.equal(result.filterReason, "Keyword match: tauschwohnung");
    assert.equal(result.title, "Helle 2-Zimmer-Wohnung");
    assert.equal(harness.browser.openCalls, 0);
  });

  it("keeps a MieterPlus listing and flags an external portal", async () => {
    const harness = createHarness();
    const plus = discoverListing("333333");
    harness.listings.save(plus);
    harness.browser.expose = sampleExpose({ isPlusOnly: true });
    const kept = await inspectListing(harness.inspect, plus);
    assert.equal(kept.status, "DISCOVERED");
    assert.equal(kept.isPlusOnly, true);

    const external = discoverListing("444444");
    harness.listings.save(external);
    harness.browser.expose = sampleExpose({ externalPortal: true });
    harness.browser.urls = [];
    const manual = await inspectListing(harness.inspect, external);
    assert.equal(manual.status, "MANUAL_REQUIRED");
    assert.equal(manual.errorCode, "EXTERNAL_PORTAL");
    assert.equal(harness.notifier.alerts.at(-1)?.type, "MANUAL_REQUIRED");
  });
});

describe("apply", () => {
  it("fills the rendered message locally and does not show it to the classifier", async () => {
    const harness = createHarness();
    const listing = discoverListing().withDetails({
      title: "Altbau",
      contactName: "Frau Müller",
      priceCold: null,
      rooms: null,
      areaSqm: null,
      isPlusOnly: false,
    });
    const result = await applyToListing(harness.apply, listing, harness.profile);
    assert.equal(result.kind, "applied");
    assert.equal(
      harness.browser.messages[0],
      "Sehr geehrte Frau Müller,\n\nInteresse an Altbau. Tel +49 170 0000000",
    );
    assert.equal(harness.classifier.contexts.length, 0);
    assert.equal(harness.selectors.get("open_contact_drawer")?.selector, "#contact");
    assert.equal(harness.listings.findById(listing.scoutId)?.sentMessage, harness.browser.messages[0]);
    assert.equal(harness.notifier.alerts[0]?.type, "APPLIED");
    if (harness.notifier.alerts[0]?.type === "APPLIED") {
      assert.equal(harness.notifier.alerts[0].title, "Altbau");
      assert.equal(JSON.stringify(harness.notifier.alerts[0]).includes("4200"), false);
    }
  });

  it("prints the application in a dry run and does not send it", async () => {
    const harness = createHarness();
    harness.apply.dryRun = true;
    const listing = discoverListing().withDetails({
      title: "Altbau",
      contactName: "Frau Müller",
      priceCold: null,
      rooms: null,
      areaSqm: null,
      isPlusOnly: false,
    });
    const result = await applyToListing(harness.apply, listing, harness.profile);
    assert.equal(result.kind, "previewed");
    assert.equal(result.listing.status, "DISCOVERED");
    assert.equal(result.listing.sentMessage, "");
    assert.equal(harness.listings.findById(listing.scoutId)?.sentMessage, "");
    assert.equal(result.listing.retryCount, 0);
    assert.equal(harness.browser.submitSelectors.length, 0);
    assert.equal(harness.browser.messages.length, 1);
    assert.match(harness.logger.previews[0] ?? "", /application not sent/);
    assert.match(harness.logger.previews[0] ?? "", /Frau Müller/);
    assert.equal(harness.notifier.alerts.length, 0);
  });

  it("rediscovers a stale selector once and then marks the listing failed", async () => {
    const harness = createHarness();
    harness.browser.openErrors = [timeout(), timeout()];
    const result = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(result.kind, "failed");
    assert.equal(result.listing.status, "FAILED");
    assert.equal(result.listing.errorCode, "SELECTOR_STALE");
    assert.equal(result.listing.retryCount, 2);
    assert.deepEqual(harness.selectors.invalidated, ["open_contact_drawer"]);
    assert.equal(harness.events.events[0]?.errorType, "SELECTOR_STALE");
  });

  it("closes two blocking popups and then applies", async () => {
    const harness = createHarness();
    const blocked = new StepFailure("FILL_FORM", "element intercepts pointer events", {
      name: "ElementClickIntercepted",
    });
    harness.browser.openErrors = [blocked, blocked];
    const result = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(result.kind, "applied");
    assert.equal(harness.browser.closePopups, 2);
  });

  it("uses the contact name on the form when the saved salutation differs", async () => {
    const harness = createHarness();
    harness.browser.liveContactName = "Herr Dr. Max Müller";
    const listing = discoverListing().withDetails({
      title: "Altbau",
      contactName: "Frau Müller",
      priceCold: null,
      rooms: null,
      areaSqm: null,
      isPlusOnly: false,
    });
    const result = await applyToListing(harness.apply, listing, harness.profile);
    assert.equal(result.kind, "applied");
    assert.equal(
      harness.browser.messages[0],
      "Sehr geehrter Herr Müller,\n\nInteresse an Altbau. Tel +49 170 0000000",
    );
  });

  it("stops before sending when required fields stay empty", async () => {
    const harness = createHarness();
    harness.browser.unfilledRequired = true;
    const result = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(result.kind, "manual");
    assert.equal(result.listing.errorCode, "VALIDATION_ERROR");
    assert.equal(harness.browser.submitSelectors.length, 0);
    assert.equal(harness.browser.messages.length, 0);
  });

  it("asks for help when validation cannot be mapped or the file input is required", async () => {
    const harness = createHarness();
    harness.browser.submitErrors = [
      new StepFailure("SUBMIT", "Bitte dieses besondere Feld ausfüllen", {
        name: "ValidationError",
        domSnippet: "Bitte dieses besondere Feld ausfüllen",
      }),
    ];
    const manual = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(manual.kind, "manual");
    assert.equal(manual.listing.errorCode, "VALIDATION_ERROR");
    assert.equal(harness.browser.filledFields.length, 0);

    const upload = createHarness();
    upload.browser.fileUpload = true;
    const blocked = await applyToListing(upload.apply, discoverListing("777777"), upload.profile);
    assert.equal(blocked.listing.errorCode, "FILE_UPLOAD");
    assert.equal(upload.browser.submitSelectors.length, 0);
  });

  it("refills a known income error twice and then stops", async () => {
    const harness = createHarness();
    const error = new StepFailure("SUBMIT", "Einkommen ist ein Pflichtfeld", {
      name: "ValidationError",
      domSnippet: "Einkommen ist ein Pflichtfeld",
    });
    harness.browser.submitErrors = [error, error, error];
    const result = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(result.kind, "manual");
    assert.equal(harness.browser.filledFields.length, 2);
    assert.deepEqual(harness.browser.filledFields[0], ["incomeAmount"]);
    assert.equal(harness.browser.submitSelectors.length, 3);
  });

  it("requeues the listing when a captcha appears and does not burn a retry", async () => {
    const harness = createHarness();
    const listing = discoverListing();
    harness.listings.save(listing);
    harness.browser.openErrors = [new CaptchaEncountered({ kind: "title", detail: "Ich bin kein Roboter" })];
    await assert.rejects(() => applyToListing(harness.apply, listing, harness.profile), CaptchaEncountered);
    const saved = harness.listings.findById(listing.scoutId);
    assert.equal(saved?.status, "DISCOVERED");
    assert.equal(saved?.retryCount, 0);
    assert.equal(saved?.errorCode, "CAPTCHA_HIT");
  });

  it("marks an external portal without retrying", async () => {
    const harness = createHarness();
    harness.browser.openErrors = [
      new StepFailure("FILL_FORM", "No message button", { name: "ExternalPortal" }),
    ];
    const result = await applyToListing(harness.apply, discoverListing(), harness.profile);
    assert.equal(result.kind, "manual");
    assert.equal(result.listing.retryCount, 0);
    assert.equal(harness.browser.openCalls, 1);
  });
});

describe("agent loop", () => {
  it("resets interrupted applications before the first tick", async () => {
    const harness = createHarness();
    const stuck = Listing.rehydrate({ ...discoverListing().startApplying().toData() });
    harness.listings.save(stuck);
    await runAgentLoop(harness.loop, new AbortController().signal, { maxTicks: 0 });
    assert.equal(harness.listings.findById(stuck.scoutId)?.status, "DISCOVERED");
  });

  it("waits outside active hours and pauses when the session is logged out", async () => {
    const harness = createHarness();
    harness.clock.current = new Date("2026-11-04T05:30:00.000Z");
    const asleep = await runTick(harness.loop, idleState(), new AbortController().signal);
    assert.equal(asleep.sleepMs, 30 * 60 * 1000);
    assert.equal(asleep.nightPhase, "sleeping");
    assert.equal(harness.browser.ensureCalls, 0);
    assert.equal(harness.logger.messages.includes("outside active hours; sleeping until 07:00 Berlin"), true);

    const stillNight = await runTick(harness.loop, asleep, new AbortController().signal);
    assert.equal(harness.logger.messages.filter((message) => message.startsWith("outside active hours")).length, 1);
    assert.equal(stillNight.nightPhase, "sleeping");

    harness.clock.current = new Date("2026-11-04T10:00:00.000Z");
    harness.browser.loggedIn = false;
    const first = await runTick(harness.loop, stillNight, new AbortController().signal);
    assert.equal(harness.logger.messages.includes("active hours started"), true);
    const second = await runTick(harness.loop, first, new AbortController().signal);
    assert.equal(harness.notifier.alerts.filter((alert) => alert.type === "SESSION_EXPIRED").length, 1);
    assert.equal(second.sessionAlertSent, true);
    assert.equal(harness.browser.urls.length, 0);
  });

  it("keeps polling at night when an overnight run is enabled", async () => {
    const harness = createHarness();
    harness.loop.overnightRun = true;
    harness.clock.current = new Date("2026-11-04T22:30:00.000Z");
    const first = await runTick(harness.loop, idleState(), new AbortController().signal);
    const second = await runTick(harness.loop, first, new AbortController().signal);
    assert.equal(first.nightPhase, "overnight");
    assert.equal(first.sleepMs, second.sleepMs);
    assert.equal(harness.browser.ensureCalls, 2);
    assert.equal(
      harness.logger.messages.filter((message) => message === "outside active hours; overnight run is continuing").length,
      1,
    );
  });

  it("cools down after one captcha and opens the breaker on the next", async () => {
    const harness = createHarness();
    harness.browser.captchaQueue = [
      { kind: "selector", detail: "geetest" },
      { kind: "selector", detail: "geetest" },
    ];
    const opened = await runTick(harness.loop, idleState(), new AbortController().signal);
    assert.equal(opened.breaker.state, "OPEN");
    assert.equal(harness.browser.checkboxClicks, 0);
    assert.equal(harness.browser.reloads, 1);
    assert.equal(harness.notifier.alerts[0]?.type, "CAPTCHA_OPEN");

    const rateLimit = createHarness();
    rateLimit.browser.captchaQueue = [{ kind: "selector", detail: "sicherheitsabfrage" }];
    const paused = await runTick(rateLimit.loop, idleState(), new AbortController().signal);
    assert.equal(paused.breaker.state, "OPEN");
    assert.equal(rateLimit.browser.reloads, 0);
    assert.equal(rateLimit.notifier.alerts[0]?.type, "CAPTCHA_OPEN");
    assert.equal(rateLimit.logger.messages.includes("captcha paused the loop"), true);

    const robotPage = createHarness();
    robotPage.browser.captchaQueue = [{ kind: "title", detail: "Ich bin kein Roboter" }];
    const robot = await runTick(robotPage.loop, idleState(), new AbortController().signal);
    assert.equal(robot.breaker.state, "OPEN");
    assert.equal(robotPage.browser.reloads, 0);
    assert.equal(robotPage.notifier.alerts[0]?.type, "CAPTCHA_OPEN");

    const checkbox = createHarness();
    checkbox.browser.captchaQueue = [
      { kind: "checkbox", detail: "recaptcha" },
      { kind: "checkbox", detail: "recaptcha" },
      null,
    ];
    const cleared = await runTick(checkbox.loop, idleState(), new AbortController().signal);
    assert.equal(cleared.breaker.state, "CLOSED");
    assert.equal(checkbox.browser.checkboxClicks, 1);
  });

  it("resumes the open breaker only when the title is clear", async () => {
    const harness = createHarness();
    const open = { ...idleState(), breaker: CaptchaBreaker.rehydrate("OPEN") };
    harness.browser.title = "Ich bin kein Roboter";
    harness.control.resume = true;
    const waiting = await runTick(harness.loop, open, new AbortController().signal);
    assert.equal(waiting.breaker.state, "OPEN");
    assert.equal(harness.control.resume, true);

    harness.browser.title = "Wohnung mieten";
    const resumed = await runTick(harness.loop, waiting, new AbortController().signal);
    assert.equal(resumed.breaker.state, "CLOSED");
    assert.equal(harness.control.resume, false);
  });

  it("applies at most the configured number of listings", async () => {
    const harness = createHarness();
    harness.loop.maxApplicationsPerCycle = 2;
    for (const id of ["100001", "100002", "100003"]) {
      harness.listings.save(discoverListing(id));
    }
    await runTick(harness.loop, idleState(), new AbortController().signal);
    assert.equal(harness.listings.listByStatus("APPLIED").length, 2);
    assert.equal(harness.listings.listByStatus("DISCOVERED").length, 1);
  });

  it("previews each listing once and leaves it unsent", async () => {
    const harness = createHarness();
    harness.loop.dryRun = true;
    harness.listings.save(discoverListing("100001"));
    const first = await runTick(harness.loop, idleState(), new AbortController().signal);
    await runTick(harness.loop, first, new AbortController().signal);
    assert.equal(harness.browser.submitSelectors.length, 0);
    assert.equal(harness.browser.openCalls, 1);
    assert.equal(harness.logger.previews.length, 1);
    assert.deepEqual(first.previewedIds, ["100001"]);
    assert.equal(harness.listings.findById("100001")?.status, "DISCOVERED");
  });
});

function idleState() {
  return {
    breaker: CaptchaBreaker.closed(),
    searchIndex: 0,
    sessionAlertSent: false,
    sleepMs: 0,
    previewedIds: [],
    nightPhase: "active",
  };
}
