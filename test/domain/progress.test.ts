import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance, backfillEntry } from "../../src/domain/progress.js";
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

  it("counts current stages and the hops between them", () => {
    const flow = buildFlow(
      [{ stage: "discovered" }, { stage: "applied" }, { stage: "applied" }],
      [
        { fromStage: "discovered", toStage: "applied" },
        { fromStage: "discovered", toStage: "applied" },
        { fromStage: "discovered", toStage: "filtered_out" },
      ],
    );
    assert.deepEqual(
      flow.nodes.map((node) => [node.id, node.count]),
      [
        ["discovered", 1],
        ["filtered_out", 0],
        ["applied", 2],
      ],
    );
    assert.equal(flow.links.find((link) => link.target === "applied")?.value, 2);
  });
});
