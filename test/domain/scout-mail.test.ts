import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarNotice, fromScout, parseScoutMail } from "../../src/domain/scout-mail.js";
import { validateCitation } from "../../src/domain/mail-citation.js";
import { calendarTimeMax, gmailSearchQuery, parseSinceFlag } from "../../src/domain/google-window.js";
import { scoutIdForEvent } from "../../src/domain/event-link.js";

const notice = `
1-Zimmer-Apartment in Berlin Wedding - U-Bahn Pankstr.
13357 Berlin
1 Zimmer · 27,8 m² · 774 € / Monat
<a href="https://www.immobilienscout24.de/expose/171599833">Inserat ansehen</a>
`;

const reply = `
Neue Nachricht: Herr Setiawan hat Ihnen geantwortet. (Objekt 171599833)
Badstr.54, 13357 Berlin
1-Zimmer-Apartment in Berlin Wedding - U-Bahn Pankstr.
13357 Berlin
700,00 €  27.8 m²  1 Zi.
Immobilien Scout GmbH, Invalidenstraße 65, 10557 Berlin
`;

describe("scout mail", () => {
  it("reads a notice card and the expose link", () => {
    const parsed = parseScoutMail(
      "ImmoScout24 <myscout@immobilienscout24.de>",
      "wir haben für dich eine neue Anfrage versendet",
      "",
      notice,
    );
    assert.equal(parsed.kind, "notice");
    assert.equal(parsed.exposeId, "171599833");
    assert.equal(parsed.postcode, "13357");
    assert.equal(parsed.rooms, "1");
    assert.equal(parsed.size, "27,8");
    assert.equal(parsed.rent, "774");
    assert.equal(parsed.title, "1-Zimmer-Apartment in Berlin Wedding - U-Bahn Pankstr.");
  });

  it("keeps the reply rent and ignores the office postcode", () => {
    const parsed = parseScoutMail(
      "Harry Setiawan <anbieter.abc@nachrichten.immobilienscout24.de>",
      "Neue Nachricht: Herr Setiawan hat Ihnen geantwortet. (Objekt 171599833)",
      reply,
      "",
    );
    assert.equal(parsed.kind, "message_copy");
    assert.equal(parsed.exposeId, "171599833");
    assert.equal(parsed.postcode, "13357");
    assert.equal(parsed.rent, "700,00");
    assert.equal(parsed.size, "27.8");
  });

  it("recognises calendar notices and scout domains", () => {
    assert.equal(calendarNotice("me@gmail.com", "Transfer Event: Apartment viewing", false), true);
    assert.equal(
      calendarNotice("ImmoScout24 <myscout@immobilienscout24.de>", "neue Anfrage versendet", false),
      false,
    );
    assert.equal(fromScout("Harry <anbieter.x@nachrichten.immobilienscout24.de>"), true);
    assert.equal(fromScout("Oleksii <doom9936.1999@gmail.com>"), false);
  });
});

describe("mail citations", () => {
  it("keeps a visit whose citation is in the mail and drops the office address", () => {
    const body = "Besichtigung am 12. November, Badstr. 54. Immobilien Scout GmbH, Invalidenstraße 65.";
    const checked = validateCitation(body, {
      address: { text: "Invalidenstraße 65", citation: "Invalidenstraße 65" },
      visit: { when: "12. November", place: "Badstr. 54", citation: "Badstr. 54" },
      contact: { name: "Frau Müller", role: "", citation: "Frau Müller" },
    });
    assert.equal(checked.ok, true);
    assert.equal(checked.proposal.address, null);
    assert.equal(checked.proposal.visit?.place, "Badstr. 54");
    assert.equal(checked.proposal.contact, null);
  });
});

describe("google windows", () => {
  it("shifts gmail bounds by a day and includes the calendar till day", () => {
    const since = new Date("2026-10-01T00:00:00.000Z");
    const till = new Date("2026-10-07T00:00:00.000Z");
    assert.equal(
      gmailSearchQuery(since, till),
      "after:2026/09/30 (from:immobilienscout24.de OR from:nachrichten.immobilienscout24.de) before:2026/10/08",
    );
    assert.equal(calendarTimeMax(till), "2026-10-08T00:00:00.000Z");
  });

  it("reads an optional since date and keeps the default when it is omitted", () => {
    assert.equal(parseSinceFlag(["sync"]), null);
    assert.equal(parseSinceFlag(["sync", "--since", "2026-10-01"])?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(parseSinceFlag(["sync", "--since=2026-10-01"])?.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.throws(() => parseSinceFlag(["sync", "--since"]), /2026-10-01/);
    assert.throws(() => parseSinceFlag(["sync", "--since", "2026-02-31"]), /2026-10-01/);
  });
});

describe("event links", () => {
  it("links an expose url and a cited visit, and refuses two matches", () => {
    assert.equal(
      scoutIdForEvent(
        {
          title: "Viewing",
          description: "https://www.immobilienscout24.de/expose/171599833",
          place: "",
          start: "2026-11-12T18:00:00+01:00",
        },
        [],
      ),
      "171599833",
    );
    const visit = {
      scoutId: "171599833",
      when: "12. November 2026",
      place: "Semmelweisstraße 40B",
      citation: "Semmelweisstraße 40B",
    };
    assert.equal(
      scoutIdForEvent(
        {
          title: "Apartment viewing",
          description: "",
          place: "Semmelweisstraße 40B, Berlin",
          start: "2026-11-12T17:00:00.000Z",
        },
        [visit],
      ),
      "171599833",
    );
    assert.equal(
      scoutIdForEvent(
        {
          title: "Apartment viewing",
          description: "",
          place: "Semmelweisstraße 40B",
          start: "2026-11-12T17:00:00.000Z",
        },
        [visit, { ...visit, scoutId: "999999999" }],
      ),
      null,
    );
  });
});
