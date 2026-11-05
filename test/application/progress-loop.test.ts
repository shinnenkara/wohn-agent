import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyToListing } from "../../src/application/apply-to-listing.js";
import { inspectListing } from "../../src/application/inspect-listing.js";
import { pollSearch } from "../../src/application/poll-search.js";
import { createHarness, discoverListing, sampleExpose } from "../fakes.js";

describe("apply loop progress", () => {
  it("records discovery without an edge, then the real outcome", async () => {
    const harness = createHarness();
    harness.browser.cards = [{ scoutId: "165686634" }];
    await pollSearch(harness.loop, harness.profile.searchUrls[0] ?? "");
    assert.equal(harness.progress.stageOf("165686634"), "discovered");
    assert.equal(harness.progress.transitions.length, 0);

    harness.browser.expose = sampleExpose({ description: "Nur Tauschwohnung" });
    harness.browser.urls.push("https://www.immobilienscout24.de/expose/165686634");
    const filtered = await inspectListing(harness.inspect, discoverListing());
    assert.equal(filtered.status, "FILTERED_OUT");
    assert.equal(harness.progress.stageOf("165686634"), "filtered_out");
    assert.equal(harness.progress.transitions[0]?.fromStage, "discovered");
    assert.equal(harness.progress.transitions[0]?.toStage, "filtered_out");
  });

  it("records applied and ignores a dry-run release", async () => {
    const harness = createHarness();
    const listing = discoverListing("165686635");
    harness.listings.insertAll([listing]);
    harness.browser.urls.push(listing.url);
    const applied = await applyToListing(harness.apply, listing, harness.profile);
    assert.equal(applied.kind, "applied");
    assert.deepEqual(
      harness.progress.transitions.map((hop) => hop.toStage),
      ["applied"],
    );

    const dry = createHarness();
    dry.apply.dryRun = true;
    const preview = discoverListing("165686636");
    dry.listings.insertAll([preview]);
    const result = await applyToListing(dry.apply, preview, dry.profile);
    assert.equal(result.kind, "previewed");
    assert.equal(result.listing.status, "DISCOVERED");
    assert.equal(dry.progress.transitions.length, 0);
    assert.equal(dry.progress.stageOf(preview.scoutId), "discovered");
  });
});
