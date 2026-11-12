import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyReply } from "../../src/domain/mail-reply.js";
import {
  INTENT_CODES,
  INTENT_PRIORITY,
  confirmTriage,
  draftIntentFor,
  dskPhase,
  proposeFromRules,
  rulesSkipModel,
  type ProposedTriage,
} from "../../src/domain/triage.js";

function proposed(patch: Partial<ProposedTriage> = {}): ProposedTriage {
  return { intents: [], redFlags: [], ...patch };
}

describe("triage firewall", () => {
  it("assigns priority from the intent code", () => {
    assert.equal(INTENT_CODES.length, 12);
    assert.equal(INTENT_PRIORITY.PORTAL_INVITE_LINK, "P0_CRITICAL");
    assert.equal(INTENT_PRIORITY.DOC_PACKAGE_REQ, "P1_HIGH");
    assert.equal(INTENT_PRIORITY.SCAM_SUSPECTED, "P2_WARNING");
    assert.equal(INTENT_PRIORITY.REJECTION, "P3_SILENT");
    assert.equal(draftIntentFor("DOC_PACKAGE_REQ"), "documents");
    assert.equal(draftIntentFor("SELF_DISCLOSURE_REQ"), "documents");
    assert.equal(draftIntentFor("PORTAL_INVITE_LINK"), null);
    assert.equal(draftIntentFor("REJECTION"), null);
    assert.equal(draftIntentFor("SCAM_SUSPECTED"), null);
    assert.equal(dskPhase("in_conversation"), "A");
    assert.equal(dskPhase("scheduled"), "B");
  });

  it("drops an intent, a slot, and a flag whose citation is missing", () => {
    const decision = confirmTriage({
      text: "Bitte senden Sie die SCHUFA.",
      stage: "applied",
      proposed: proposed({
        intents: [
          {
            code: "DOC_PACKAGE_REQ",
            confidence: 0.8,
            summary: "payslips",
            citation: "three payslips",
            deepLink: "",
            linkCitation: "",
            requestedDocuments: ["PAYSLIPS_3M"],
            proposedSlots: [{ text: "Montag 18 Uhr", citation: "Montag 18 Uhr" }],
          },
        ],
        redFlags: [{ code: "UPFRONT_PAYMENT_OR_FEE", citation: "500 Euro" }],
      }),
    });
    assert.equal(decision.intents.length, 0);
    assert.equal(decision.blocked, false);
    assert.equal(decision.draft, null);
    assert.deepEqual(decision.redFlags, []);
  });

  it("blocks a cited upfront fee and a passport scan", () => {
    const fee = confirmTriage({
      text: "Bitte überweisen Sie 500 € vorab.",
      stage: "applied",
      proposed: proposed({
        intents: [
          {
            code: "APPT_PROPOSAL",
            confidence: 1,
            summary: "viewing",
            citation: "500 €",
            deepLink: "",
            linkCitation: "",
            requestedDocuments: [],
            proposedSlots: [],
          },
        ],
        redFlags: [{ code: "UPFRONT_PAYMENT_OR_FEE", citation: "500 €" }],
      }),
    });
    assert.equal(fee.blocked, true);
    assert.equal(fee.riskLevel, "CRITICAL_SCAM_BLOCK");
    assert.equal(fee.draft, null);
    assert.equal(fee.intents.some((intent) => intent.code === "SCAM_SUSPECTED"), true);

    const scan = confirmTriage({
      text: "Bitte schicken Sie eine Passkopie.",
      stage: "viewing_offered",
      proposed: proposed({
        redFlags: [{ code: "UNSOLICITED_PASSPORT_SCAN", citation: "Passkopie" }],
      }),
    });
    assert.equal(scan.blocked, true);
  });

  it("blocks a landlord abroad only together with a refused viewing", () => {
    const abroad = confirmTriage({
      text: "Ich wohne derzeit im Ausland.",
      stage: "applied",
      proposed: proposed({
        redFlags: [{ code: "LANDLORD_ABROAD", citation: "im Ausland" }],
      }),
    });
    assert.equal(abroad.blocked, false);
    assert.deepEqual(abroad.redFlags, ["LANDLORD_ABROAD"]);

    const refused = confirmTriage({
      text: "Ich wohne im Ausland und es gibt keine Besichtigung.",
      stage: "applied",
      proposed: proposed({
        redFlags: [{ code: "LANDLORD_ABROAD", citation: "im Ausland" }],
      }),
    });
    assert.equal(refused.blocked, true);
  });

  it("warns for phase A identity and bank requests and keeps the document draft", () => {
    const warned = confirmTriage({
      text: "Bitte senden Sie die SCHUFA und einen Kontoauszug sowie den Ausweis.",
      stage: "in_conversation",
      proposed: proposed({
        intents: [
          {
            code: "DOC_PACKAGE_REQ",
            confidence: 90,
            summary: "documents",
            citation: "SCHUFA",
            deepLink: "javascript:alert(1)",
            linkCitation: "SCHUFA",
            requestedDocuments: ["SCHUFA_BONITAETSCHECK", "BANK_STATEMENT_REDACTED", "ID_FRONT_BACK", "PAYSLIPS_3M"],
            proposedSlots: [],
          },
        ],
      }),
    });
    assert.equal(warned.riskLevel, "WARN_DSGVO_VIOLATION");
    assert.equal(warned.blocked, false);
    assert.equal(warned.draft?.intent, "documents");
    assert.equal(warned.intents.find((intent) => intent.code === "DOC_PACKAGE_REQ")?.dskViolation, true);
    assert.equal(warned.intents.find((intent) => intent.code === "DOC_PACKAGE_REQ")?.metadata.actionDeepLink, null);
    assert.equal(warned.intents.find((intent) => intent.code === "DOC_PACKAGE_REQ")?.confidence, 0.9);

    const later = confirmTriage({
      text: "Bitte senden Sie die SCHUFA.",
      stage: "scheduled",
      proposed: proposed({
        intents: [
          {
            code: "DOC_PACKAGE_REQ",
            confidence: 1,
            summary: "documents",
            citation: "SCHUFA",
            deepLink: "",
            linkCitation: "",
            requestedDocuments: ["SCHUFA_BONITAETSCHECK"],
            proposedSlots: [],
          },
        ],
      }),
    });
    assert.equal(later.riskLevel, "SAFE");
    assert.equal(later.intents.some((intent) => intent.code === "SCAM_SUSPECTED"), false);
  });

  it("lets payslips pass in phase A and prefers the portal priority over the draft", () => {
    const payslips = confirmTriage({
      text: "Bitte senden Sie drei Gehaltsnachweise. https://portal.example/invite",
      stage: "applied",
      proposed: proposed({
        intents: [
          {
            code: "DOC_PACKAGE_REQ",
            confidence: 1,
            summary: "payslips",
            citation: "Gehaltsnachweise",
            deepLink: "",
            linkCitation: "",
            requestedDocuments: ["PAYSLIPS_3M"],
            proposedSlots: [],
          },
          {
            code: "PORTAL_INVITE_LINK",
            confidence: 1,
            summary: "portal",
            citation: "https://portal.example/invite",
            deepLink: "https://portal.example/invite",
            linkCitation: "https://portal.example/invite",
            requestedDocuments: [],
            proposedSlots: [],
          },
        ],
      }),
    });
    assert.equal(payslips.riskLevel, "SAFE");
    assert.equal(payslips.priority, "P0_CRITICAL");
    assert.equal(payslips.notify, true);
    assert.equal(payslips.draft?.intent, "documents");
    assert.equal(payslips.intents[0]?.code, "PORTAL_INVITE_LINK");
  });

  it("skips the model for a pure receipt and still calls it when a document is bundled", () => {
    const receipt = classifyReply("Eingang", "Wir haben Ihre Anfrage erhalten.", null);
    assert.equal(rulesSkipModel("Eingang", "Wir haben Ihre Anfrage erhalten.", receipt), true);
    const bundled = classifyReply("Eingang", "Wir haben Ihre Anfrage erhalten. Bitte senden Sie die SCHUFA.", null);
    assert.equal(
      rulesSkipModel("Eingang", "Wir haben Ihre Anfrage erhalten. Bitte senden Sie die SCHUFA.", bundled),
      false,
    );
    const rules = proposeFromRules({
      from: "ImmoScout24 <myscout@immobilienscout24.de>",
      subject: "Eingang",
      body: "Wir haben Ihre Anfrage erhalten.",
      classification: receipt ?? { intent: "receipt", relation: null, topic: null, evidence: "" },
    });
    const decision = confirmTriage({
      text: "Eingang\nWir haben Ihre Anfrage erhalten.",
      stage: "applied",
      proposed: rules,
    });
    assert.equal(decision.intents[0]?.code, "IS24_AUTO_ACK");
    assert.equal(decision.notify, false);
  });
});
