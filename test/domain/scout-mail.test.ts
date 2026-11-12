import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarNotice, fromScout, parseScoutMail } from "../../src/domain/scout-mail.js";
import { validateCitation } from "../../src/domain/mail-citation.js";
import { matchAddress } from "../../src/domain/mail-link.js";
import { stripQuotedReply } from "../../src/domain/strip-reply.js";
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

  it("does not treat a saved search as an application notice", () => {
    const parsed = parseScoutMail(
      "ImmoScout24 <myscout@immobilienscout24.de>",
      "Neuer Suchauftrag wurde angelegt",
      "Link: https://www.immobilienscout24.de/expose/171641591",
      "",
    );
    assert.equal(parsed.kind, "unclassified");
    assert.equal(parsed.exposeId, "171641591");
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
      "after:2026/09/30 before:2026/10/08",
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

describe("quoted replies", () => {
  it("keeps the new sentence and drops the quoted document request", () => {
    const plain = stripQuotedReply(
      "Der Termin ist bestätigt.\n\nAm 11.11.2026 um 10:00 schrieb Vermieter:\nBitte senden Sie die SCHUFA und die Gehaltsnachweise.",
      "",
    );
    assert.equal(plain, "Der Termin ist bestätigt.");
    const html = stripQuotedReply(
      "",
      "<div>Der Termin ist bestätigt.</div><div class=\"gmail_quote\"><div>Am 11.11.2026 schrieb Vermieter:</div><blockquote>Bitte senden Sie die SCHUFA.</blockquote></div>",
    );
    assert.equal(html, "Der Termin ist bestätigt.");
    const outlook = stripQuotedReply(
      "",
      "<div>Freitag passt.</div><div id=\"divRplyFwdMsg\">-----Original Message-----</div><div>Bitte senden Sie die SCHUFA.</div>",
    );
    assert.equal(outlook, "Freitag passt.");
    const inline = stripQuotedReply("Ja.\n\n> alte Frage\n\nDie Miete ist 800 €.\n\n> noch älter", "");
    assert.match(inline, /^Ja\./);
    assert.match(inline, /Die Miete ist 800 €/);
    assert.equal(inline.includes("alte Frage"), false);
  });
});

describe("address matching", () => {
  it("requires a street plus a zip or the cold rent, and refuses two hits", () => {
    const one = matchAddress("Bitte kommen Sie in die Badstraße 54, 13357 Berlin.", [
      { scoutId: "1", title: null, address: "Badstraße 54, 13357 Berlin", priceCold: 800 },
      { scoutId: "2", title: null, address: "Hauptstraße 2, 10115 Berlin", priceCold: 900 },
    ]);
    assert.deepEqual(one, { scoutId: "1" });
    assert.equal(matchAddress("Die Kaltmiete beträgt 800 €.", [
      { scoutId: "1", title: null, address: "Badstraße 54, 13357 Berlin", priceCold: 800 },
      { scoutId: "2", title: null, address: "Hauptstraße 2, 10115 Berlin", priceCold: 800 },
    ]), null);
    assert.equal(
      matchAddress("Badstraße 54, 13357 Berlin, 800 €", [
        { scoutId: "1", title: null, address: "Badstraße 54, 13357 Berlin", priceCold: 800 },
        { scoutId: "2", title: null, address: "Badstraße 10, 13357 Berlin", priceCold: 800 },
      ]),
      "ambiguous",
    );
  });
});
