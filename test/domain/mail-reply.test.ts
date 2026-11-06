import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyReply,
  eveningSlots,
  formatEvening,
  gmailComposeUrl,
  mailboxAddress,
  nextTopic,
  renderDraft,
  settleReply,
  type OpenTopic,
} from "../../src/domain/mail-reply.js";
import { berlinInstant } from "../../src/domain/timing.js";

const documents: OpenTopic = { topic: "documents", relation: "start" };

describe("mail reply classification", () => {
  it("opens a document topic and drafts the pack", () => {
    const classification = classifyReply("Unterlagen", "Bitte senden Sie die SCHUFA und die Selbstauskunft.", null);
    assert.equal(classification?.intent, "documents");
    assert.equal(classification?.relation, "start");
    assert.deepEqual(nextTopic(null, classification!), { topic: "documents", relation: "start" });
    const draft = renderDraft({
      classification: classification!,
      subject: "Unterlagen",
      body: "Bitte senden Sie die SCHUFA und die Selbstauskunft.",
      contactName: "Frau Müller",
      slots: [],
      visit: null,
    });
    assert.equal(draft?.body.startsWith("Sehr geehrte Frau Müller,"), true);
    assert.equal(draft?.body.includes("SCHUFA"), true);
    assert.equal(draft?.altBody, "");
  });

  it("keeps a later document ask on the same topic", () => {
    const classification = classifyReply("Re: Unterlagen", "Es fehlt noch die Schufa-Auskunft.", documents);
    assert.equal(classification?.relation, "continue");
    assert.equal(classification?.topic, "documents");
    assert.equal(classification?.intent, "documents");
    const draft = renderDraft({
      classification: classification!,
      subject: "Re: Unterlagen",
      body: "Bitte laden Sie die Datei hier hoch: https://upload.example/pack",
      contactName: null,
      slots: [],
      visit: null,
    });
    assert.equal(draft?.body.includes("https://upload.example/pack"), true);
  });

  it("stores a soft reply on the open topic without a draft", () => {
    const classification = classifyReply("Re: Unterlagen", "Danke, wir prüfen die Unterlagen und melden uns.", documents);
    assert.equal(classification?.relation, "continue");
    assert.equal(classification?.topic, "documents");
    assert.equal(
      renderDraft({
        classification: classification!,
        subject: "Re: Unterlagen",
        body: "Danke, wir prüfen die Unterlagen und melden uns.",
        contactName: null,
        slots: [],
        visit: null,
      }),
      null,
    );
  });

  it("leaves the topic unchanged for a receipt", () => {
    const classification = classifyReply("Eingang", "Wir haben Ihre Anfrage erhalten.", documents);
    assert.equal(classification?.intent, "receipt");
    assert.equal(classification?.relation, null);
    assert.equal(nextTopic(documents, classification!), documents);
  });

  it("closes a thread when the flat is already rented", () => {
    const classification = classifyReply("Absage", "Die Wohnung ist bereits vergeben.", documents);
    assert.equal(classification?.relation, "close");
    assert.equal(classification?.topic, "documents");
    assert.equal(
      renderDraft({
        classification: classification!,
        subject: "Absage",
        body: "Die Wohnung ist bereits vergeben.",
        contactName: null,
        slots: [],
        visit: null,
      }),
      null,
    );
  });

  it("confirms a cited viewing and closes that topic", () => {
    const body = "Die Besichtigung ist am 12. November 2026, Badstr. 54.";
    const classification = classifyReply("Termin", body, { topic: "viewing", relation: "start" });
    assert.equal(classification?.intent, "viewing_confirm");
    assert.equal(classification?.relation, "close");
    const draft = renderDraft({
      classification: classification!,
      subject: "Termin",
      body,
      contactName: "Herr Meier",
      slots: [],
      visit: { when: "12. November 2026", place: "Badstr. 54", citation: "12. November 2026" },
    });
    assert.equal(draft?.body.includes("12. November 2026"), true);
    assert.equal(draft?.body.includes("Badstr. 54"), true);
  });

  it("does not confirm a viewing when no slot is cited", () => {
    const classification = classifyReply("Termin", "Die Besichtigung ist am 12. November 2026.", null);
    assert.equal(
      renderDraft({
        classification: classification!,
        subject: "Termin",
        body: "Die Besichtigung ist am 12. November 2026.",
        contactName: null,
        slots: [],
        visit: null,
      }),
      null,
    );
  });

  it("offers three free weekday evenings and asks for times when the window is full", () => {
    const now = new Date("2026-11-02T10:00:00.000Z");
    const tuesday = berlinInstant({ year: 2026, month: 11, day: 3, hour: 18, minute: 0, second: 0 });
    const slots = eveningSlots(now, [{ start: tuesday.toISOString(), end: new Date(tuesday.getTime() + 60 * 60 * 1000).toISOString() }]);
    assert.deepEqual(slots.map(formatEvening), [
      "Montag, 2. November, 18:00",
      "Mittwoch, 4. November, 18:00",
      "Donnerstag, 5. November, 18:00",
    ]);
    const busy = eveningSlots(now, slots.flatMap((slot) => [{ start: slot.toISOString(), end: new Date(slot.getTime() + 60 * 60 * 1000).toISOString() }]));
    const blocked = Array.from({ length: 14 }, (_, offset) => {
      const start = berlinInstant({ year: 2026, month: 11, day: 2 + offset, hour: 18, minute: 0, second: 0 });
      return { start: start.toISOString(), end: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
    });
    assert.equal(eveningSlots(now, blocked).length, 0);
    assert.equal(busy.length >= 0, true);
    const classification = classifyReply("Termine", "Wann können Sie zur Besichtigung kommen?", null);
    const draft = renderDraft({
      classification: classification!,
      subject: "Termine",
      body: "Wann können Sie zur Besichtigung kommen?",
      contactName: null,
      slots: [],
      visit: null,
    });
    assert.equal(draft?.body.includes("Bitte nennen Sie mir ein paar mögliche Zeiten."), true);
    const offered = renderDraft({
      classification: classification!,
      subject: "Termine",
      body: "Wann können Sie zur Besichtigung kommen?",
      contactName: null,
      slots,
      visit: null,
    });
    assert.equal(offered?.body.includes("Montag, 2. November, 18:00"), true);
    assert.equal(offered?.body.includes("Dienstag"), false);
  });

  it("writes two drafts for a viewing follow-up and a contract outcome", () => {
    const follow = classifyReply("Rückfrage", "Sind Sie nach der Besichtigung noch interessiert?", {
      topic: "viewing",
      relation: "close",
    });
    assert.equal(follow?.intent, "viewing_followup");
    assert.equal(follow?.relation, "start");
    const followDraft = renderDraft({
      classification: follow!,
      subject: "Rückfrage",
      body: "Sind Sie nach der Besichtigung noch interessiert?",
      contactName: null,
      slots: [],
      visit: null,
    });
    assert.equal(followDraft?.body.includes("weiterhin interessiert"), true);
    assert.equal(followDraft?.altBody.includes("Bewerbung zurück"), true);
    const outcome = classifyReply("Vertrag", "Möchten Sie den Vertrag annehmen?", null);
    const outcomeDraft = renderDraft({
      classification: outcome!,
      subject: "Vertrag",
      body: "Möchten Sie den Vertrag annehmen?",
      contactName: null,
      slots: [],
      visit: null,
    });
    assert.equal(outcome?.relation, "close");
    assert.equal(outcomeDraft?.altBody.includes("nicht abschließen"), true);
  });

  it("drops a model intent whose evidence is not in the mail", () => {
    const open = documents;
    const settled = settleReply(open, "documents", "nicht im text", "Betreff", "Hallo zusammen");
    assert.equal(settled.intent, "unknown");
    assert.equal(nextTopic(open, settled), open);
  });

  it("opens Gmail with the draft filled in", () => {
    const url = gmailComposeUrl({
      account: "a@example.com",
      to: mailboxAddress("Vermieter <landlord@example.com>", "Other <other@example.com>"),
      subject: "Wohnung",
      body: "Guten Tag,\n\nGerne.",
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("view"), "cm");
    assert.equal(parsed.searchParams.get("to"), "landlord@example.com");
    assert.equal(parsed.searchParams.get("su"), "Re: Wohnung");
    assert.equal(parsed.searchParams.get("authuser"), "a@example.com");
    assert.equal(parsed.searchParams.get("body")?.includes("Gerne."), true);
    assert.equal(
      gmailComposeUrl({ account: "a@example.com", to: "landlord@example.com", subject: "Wohnung", body: "x".repeat(2000) }),
      "",
    );
  });
});
