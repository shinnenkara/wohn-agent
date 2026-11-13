import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CalendarAgenda } from "../../src/adapters/google/calendar-client.js";

describe("calendar client", () => {
  it("keeps a cancelled event so a stored visit can be removed", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          items: [
            { id: "e1", status: "cancelled" },
            {
              id: "e2",
              status: "confirmed",
              summary: "Visit",
              start: { dateTime: "2026-11-12T17:00:00Z" },
              end: { dateTime: "2026-11-12T18:00:00Z" },
            },
          ],
          nextSyncToken: "tok",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const agenda = new CalendarAgenda({ async accessToken() { return "token"; } }, fetchImpl);
    const page = await agenda.changes("sync");
    assert.equal(page.events[0]?.id, "e1");
    assert.equal(page.events[0]?.cancelled, true);
    assert.equal(page.events[1]?.title, "Visit");
    assert.equal(page.events[1]?.cancelled, undefined);
  });
});
