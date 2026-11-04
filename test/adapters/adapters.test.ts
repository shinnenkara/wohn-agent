import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseEnv } from "../../src/adapters/config/env.js";
import { loadProfile } from "../../src/adapters/config/load-profile.js";
import { openDatabase } from "../../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../../src/adapters/sqlite/event-log.js";
import { SqliteListingRepository } from "../../src/adapters/sqlite/listing-repository.js";
import { SqliteSelectorCache } from "../../src/adapters/sqlite/selector-cache-repository.js";
import { classifyByRules } from "../../src/adapters/stagehand/classify-by-rules.js";
import { interpretExpose, parseGermanAmount, uniqueScoutIds } from "../../src/adapters/stagehand/parse-listing-text.js";
import { toStagehandVariables, validationInstruction } from "../../src/adapters/stagehand/profile-variables.js";
import {
  MESSAGE_FIELD_INSTRUCTION,
  REQUIRED_FIELDS_INSTRUCTION,
} from "../../src/adapters/stagehand/instructions.js";
import {
  buildClassifierPrompt,
  parseClassifierDecision,
  RulesThenGeminiClassifier,
} from "../../src/adapters/stagehand/rules-then-gemini-classifier.js";
import { CAPTCHA_ALERT_TEXT, formatAlert } from "../../src/adapters/telegram/telegram-notifier.js";
import type { FailureContext } from "../../src/application/ports/failure-classifier.js";
import { discoverListing, sampleProfile } from "../fakes.js";

const context = (patch: Partial<FailureContext>): FailureContext => ({
  step: "FILL_FORM",
  errorName: "Error",
  message: "",
  domSnippet: "",
  ...patch,
});

describe("sqlite repositories", () => {
  it("round-trips listings, selectors, and events", () => {
    const dir = mkdtempSync(join(tmpdir(), "wohn-agent-"));
    const db = openDatabase(join(dir, "agent.db"));
    try {
      const listings = new SqliteListingRepository(db);
      const discovered = discoverListing();
      listings.insertAll([discovered, discovered]);
      assert.equal(listings.findById(discovered.scoutId)?.status, "DISCOVERED");
      const applying = discovered.startApplying();
      listings.save(applying);
      assert.equal(listings.resetApplyingToDiscovered(), 1);
      assert.equal(listings.findById(discovered.scoutId)?.status, "DISCOVERED");
      assert.equal(listings.findById(discovered.scoutId)?.retryCount, 0);

      const cache = new SqliteSelectorCache(db);
      cache.upsert({
        actionKey: "open_contact_drawer",
        instruction: "find the button",
        selector: "#contact",
        method: "click",
        failCount: 0,
        updatedAt: new Date("2026-11-04T10:00:00.000Z"),
      });
      cache.recordFailure("open_contact_drawer");
      assert.equal(cache.get("open_contact_drawer")?.failCount, 1);
      cache.invalidate("open_contact_drawer");
      assert.equal(cache.get("open_contact_drawer"), null);

      const events = new SqliteEventLog(db);
      events.append({
        scoutId: discovered.scoutId,
        step: "CAPTCHA",
        errorType: "CAPTCHA_HIT",
        domSnippet: "Ich bin kein Roboter",
        resolutionAction: "HALF_OPEN",
        createdAt: new Date("2026-11-04T10:00:00.000Z"),
      });
      assert.equal(events.listAll()[0]?.errorType, "CAPTCHA_HIT");
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifier", () => {
  it("classifies known browser failures without calling Gemini", async () => {
    const cases: Array<[FailureContext, string]> = [
      [context({ errorName: "ElementClickIntercepted" }), "POPUP_BLOCKED"],
      [context({ message: "element intercepts pointer events" }), "POPUP_BLOCKED"],
      [context({ errorName: "TimeoutError", message: "Timeout 3000ms exceeded" }), "SELECTOR_STALE"],
      [context({ errorName: "ConfirmationTimeout" }), "SELECTOR_STALE"],
      [context({ errorName: "ValidationError" }), "VALIDATION_ERROR"],
      [context({ domSnippet: "Einkommen ist ein Pflichtfeld" }), "VALIDATION_ERROR"],
      [context({ errorName: "ExternalPortal", message: "No message button" }), "EXTERNAL_PORTAL"],
      [context({ errorName: "CaptchaHit" }), "CAPTCHA_HIT"],
      [context({ domSnippet: "#captcha-box" }), "CAPTCHA_HIT"],
      [context({ message: "Ich bin kein Roboter" }), "CAPTCHA_HIT"],
    ];
    for (const [input, expected] of cases) {
      assert.equal(classifyByRules(input), expected);
    }
    assert.equal(classifyByRules(context({ message: "something novel" })), null);

    let calls = 0;
    const classifier = new RulesThenGeminiClassifier(async () => {
      calls += 1;
      return '{"error_type":"POPUP_BLOCKED"}';
    });
    assert.equal(await classifier.classify(context({ errorName: "TimeoutError" })), "SELECTOR_STALE");
    assert.equal(calls, 0);
    assert.equal(await classifier.classify(context({ message: "something novel" })), "POPUP_BLOCKED");
    assert.equal(calls, 1);
    assert.equal(parseClassifierDecision('```json\n{"error_type":"EXTERNAL_PORTAL"}\n```'), "EXTERNAL_PORTAL");
  });

  it("keeps applicant values out of the classifier prompt and observe instructions", () => {
    const profile = sampleProfile();
    const prompt = buildClassifierPrompt(context({ message: "Timeout 3000ms exceeded" }));
    assert.equal(prompt.includes(profile.formData.phone), false);
    assert.equal(prompt.includes("Do not include or request personal data."), true);
    assert.equal(REQUIRED_FIELDS_INSTRUCTION.includes(profile.formData.phone), false);
    assert.equal(MESSAGE_FIELD_INSTRUCTION.includes("{{"), false);
    assert.equal(validationInstruction(["phone"]).includes(profile.formData.phone), false);
    assert.equal(toStagehandVariables(profile.formData).phone?.value, profile.formData.phone);
  });
});

describe("listing text, profile, and alerts", () => {
  it("parses expose facts and scout ids", () => {
    const facts = interpretExpose({
      title: "Altbau",
      contactName: null,
      description: "",
      bodyText: "Frau Schulz\nKaltmiete 1.250 €\n2 Zimmer\n60 m²\nNur mit MieterPlus",
      hasMessageButton: false,
      hasExternalLink: true,
      hasPhoneOnly: false,
    });
    assert.equal(facts.contactName, "Frau Schulz");
    assert.equal(facts.priceCold, 1250);
    assert.equal(facts.rooms, 2);
    assert.equal(facts.areaSqm, 60);
    assert.equal(facts.isPlusOnly, true);
    assert.equal(facts.externalPortal, true);
    assert.equal(parseGermanAmount("850,50"), 850.5);
    assert.deepEqual(uniqueScoutIds(["12", "165686634", "165686634", "abc"]), ["165686634"]);
  });

  it("loads the example profile and formats alerts without income", () => {
    const profile = loadProfile("applicant_profile.example.json");
    assert.equal(profile.formData.lastName, "Mustermann");
    assert.equal(profile.blacklistKeywords[0], "tauschwohnung");
    const source = {
      GOOGLE_GENERATIVE_AI_API_KEY: "key",
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "42",
    };
    const config = parseEnv(source);
    assert.equal(config.modelName, "google/gemini-3.8-flash");
    assert.equal(config.maxApplicationsPerCycle, 5);
    assert.equal(config.dryRun, false);
    assert.equal(config.overnightRun, false);
    assert.equal(config.appEnv, "prod");
    assert.equal(parseEnv({ ...source, DRY_RUN: "true" }).dryRun, true);
    assert.equal(parseEnv({ ...source, OVERNIGHT_RUN: "true" }).overnightRun, true);
    assert.equal(parseEnv({ ...source, APP_ENV: "dev" }).appEnv, "dev");
    assert.equal(parseEnv({ ...source, APP_ENV: " DEV " }).appEnv, "dev");
    assert.throws(() => parseEnv({ ...source, APP_ENV: "staging" }));
    assert.equal(formatAlert({ type: "CAPTCHA_OPEN" }), CAPTCHA_ALERT_TEXT);
    const applied = formatAlert({
      type: "APPLIED",
      scoutId: "165686634",
      title: "Altbau",
      url: "https://www.immobilienscout24.de/expose/165686634",
    });
    assert.equal(applied.includes("4200"), false);
    assert.equal(applied.includes("165686634"), true);
  });
});
