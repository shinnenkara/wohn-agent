import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance, backfillEntry, FUNNEL_STAGES, parentStage, stageBranch } from "../../src/domain/progress.js";
import { buildFlow } from "../../src/domain/funnel.js";

describe("funnel progress", () => {
  it("enters without an edge and moves only forward", () => {
    const entered = advance(null, "discovered");
    assert.equal(entered.moved, true);
    assert.equal(entered.from, null);
    const applied = advance("discovered", "applied");
    assert.deepEqual(applied, { stage: "applied", from: "discovered", moved: true });
    const backward = advance("applied", "discovered");
    assert.equal(backward.moved, false);
    assert.equal(backward.stage, "applied");
    const sideways = advance("filtered_out", "manual");
    assert.equal(sideways.moved, false);
    assert.equal(sideways.stage, "filtered_out");
  });

  it("backfills one hop into the current stage", () => {
    assert.equal(backfillEntry("DISCOVERED").hop, null);
    assert.equal(backfillEntry("APPLYING").hop, null);
    assert.deepEqual(backfillEntry("APPLIED").hop, { from: "discovered", to: "applied" });
    assert.deepEqual(backfillEntry("FAILED").hop, { from: "discovered", to: "failed" });
  });

  it("puts each later stage under one earlier parent", () => {
    assert.equal(parentStage("discovered"), null);
    assert.deepEqual(stageBranch("filtered_out"), ["filtered_out"]);
    assert.deepEqual(stageBranch("applied"), ["applied", "in_conversation", "viewing_offered", "scheduled"]);
    assert.deepEqual(stageBranch("discovered"), [...FUNNEL_STAGES]);
    for (const stage of FUNNEL_STAGES) {
      const parent = parentStage(stage);
      if (parent) {
        assert.equal(advance(parent, stage).moved, true);
      }
    }
  });

  it("rolls open apartments up the tree and skips empty branches", () => {
    const flow = buildFlow([{ stage: "discovered" }, { stage: "applied" }, { stage: "applied" }]);
    assert.deepEqual(
      flow.nodes.map((node) => [node.id, node.count, node.stock]),
      [
        ["discovered", 3, 1],
        ["applied", 2, 2],
      ],
    );
    assert.equal(flow.links.find((link) => link.target === "applied")?.value, 2);
    assert.equal(flow.links.find((link) => link.target === "filtered_out"), undefined);

    const nested = buildFlow([
      ...Array.from({ length: 20 }, () => ({ stage: "applied" as const })),
      { stage: "filtered_out" },
      { stage: "in_conversation" },
    ]);
    assert.deepEqual(
      nested.nodes.map((node) => [node.id, node.count, node.stock]),
      [
        ["discovered", 22, 0],
        ["filtered_out", 1, 1],
        ["applied", 21, 20],
        ["in_conversation", 1, 1],
      ],
    );
    assert.equal(nested.nodes.find((node) => node.id === "in_conversation")?.parent, "applied");
    assert.equal(nested.links.find((link) => link.target === "applied")?.value, 21);
    assert.equal(nested.links.find((link) => link.target === "in_conversation")?.source, "applied");
  });
});
