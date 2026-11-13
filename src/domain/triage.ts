import { citedVisit, quotedRejection, type MailClassification, type MailIntent } from "./mail-reply.js";
import type { FunnelStage } from "./progress.js";
import { fromScout } from "./scout-mail.js";

export const INTENT_CODES = [
  "IS24_AUTO_ACK",
  "LANDLORD_WAIT_ACK",
  "PORTAL_INVITE_LINK",
  "DOC_PACKAGE_REQ",
  "SELF_DISCLOSURE_REQ",
  "APPT_PROPOSAL",
  "APPT_CONFIRMATION",
  "APPT_CANCELLED_BY_US",
  "APPT_SLOT_CANCELLED",
  "POST_VIEWING_INTEREST",
  "CONTRACT_DRAFT_REVIEW",
  "CONTRACT_SIGNING_ARR",
  "REJECTION",
  "SCAM_SUSPECTED",
] as const;

export type IntentCode = (typeof INTENT_CODES)[number];

export const PRIORITIES = ["P0_CRITICAL", "P1_HIGH", "P2_WARNING", "P3_SILENT"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const DOCUMENT_CODES = [
  "SCHUFA_BONITAETSCHECK",
  "PAYSLIPS_3M",
  "BANK_STATEMENT_REDACTED",
  "TAX_ASSESSMENT",
  "ID_FRONT_BACK",
  "MIETSCHULDENFREIHEIT",
  "WBS",
  "ARBEITSVERTRAG",
  "BUERGSCHAFT",
] as const;

export type DocumentCode = (typeof DOCUMENT_CODES)[number];

export const RED_FLAGS = [
  "LANDLORD_ABROAD",
  "UPFRONT_PAYMENT_OR_FEE",
  "PRE_VIEWING_PII_HARVEST",
  "ROUND_SYMBOLIC_DEPOSIT",
  "UNVERIFIED_EXTERNAL_ALBUM",
  "IBAN_MISMATCH",
  "FOREIGN_IBAN",
  "PRESSURE_URGENCY",
  "UNSOLICITED_PASSPORT_SCAN",
] as const;

export type RedFlag = (typeof RED_FLAGS)[number];

export const RISK_LEVELS = ["SAFE", "WARN_DSGVO_VIOLATION", "CRITICAL_SCAM_BLOCK"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RELEVANCE_LABELS = ["unrelated", "possible"] as const;

export type Relevance = (typeof RELEVANCE_LABELS)[number];

export const INTENT_PRIORITY: Record<IntentCode, Priority> = {
  PORTAL_INVITE_LINK: "P0_CRITICAL",
  APPT_PROPOSAL: "P0_CRITICAL",
  APPT_SLOT_CANCELLED: "P0_CRITICAL",
  CONTRACT_DRAFT_REVIEW: "P0_CRITICAL",
  CONTRACT_SIGNING_ARR: "P0_CRITICAL",
  APPT_CONFIRMATION: "P1_HIGH",
  POST_VIEWING_INTEREST: "P1_HIGH",
  SELF_DISCLOSURE_REQ: "P1_HIGH",
  DOC_PACKAGE_REQ: "P1_HIGH",
  SCAM_SUSPECTED: "P2_WARNING",
  IS24_AUTO_ACK: "P3_SILENT",
  LANDLORD_WAIT_ACK: "P3_SILENT",
  REJECTION: "P3_SILENT",
  APPT_CANCELLED_BY_US: "P3_SILENT",
};

const DRAFT_INTENT: Record<IntentCode, MailIntent | null> = {
  PORTAL_INVITE_LINK: null,
  APPT_PROPOSAL: "viewing_schedule",
  APPT_CANCELLED_BY_US: null,
  APPT_SLOT_CANCELLED: "slot_cancelled",
  CONTRACT_DRAFT_REVIEW: "contract_outcome",
  CONTRACT_SIGNING_ARR: "contract_schedule",
  APPT_CONFIRMATION: "viewing_confirm",
  POST_VIEWING_INTEREST: "viewing_followup",
  SELF_DISCLOSURE_REQ: "documents",
  DOC_PACKAGE_REQ: "documents",
  SCAM_SUSPECTED: null,
  IS24_AUTO_ACK: "receipt",
  LANDLORD_WAIT_ACK: "waitlist",
  REJECTION: null,
};

const MAIL_INTENT_CODE: Partial<Record<MailIntent, IntentCode>> = {
  documents: "DOC_PACKAGE_REQ",
  viewing_schedule: "APPT_PROPOSAL",
  viewing_confirm: "APPT_CONFIRMATION",
  viewing_followup: "POST_VIEWING_INTEREST",
  cancelled_by_us: "APPT_CANCELLED_BY_US",
  slot_cancelled: "APPT_SLOT_CANCELLED",
  contract_schedule: "CONTRACT_SIGNING_ARR",
  contract_confirm: "CONTRACT_SIGNING_ARR",
  contract_outcome: "CONTRACT_DRAFT_REVIEW",
};

const PHASE_A_DOCUMENTS = new Set<DocumentCode>([
  "ID_FRONT_BACK",
  "SCHUFA_BONITAETSCHECK",
  "BANK_STATEMENT_REDACTED",
]);

const DOCUMENT_SIGNALS: ReadonlyArray<readonly [string, DocumentCode]> = [
  ["schufa", "SCHUFA_BONITAETSCHECK"],
  ["gehaltsnachweis", "PAYSLIPS_3M"],
  ["gehaltsabrechnung", "PAYSLIPS_3M"],
  ["lohnabrechnung", "PAYSLIPS_3M"],
  ["kontoauszug", "BANK_STATEMENT_REDACTED"],
  ["steuerbescheid", "TAX_ASSESSMENT"],
  ["personalausweis", "ID_FRONT_BACK"],
  ["ausweiskopie", "ID_FRONT_BACK"],
  ["mietschulden", "MIETSCHULDENFREIHEIT"],
  ["arbeitsvertrag", "ARBEITSVERTRAG"],
  ["bürgschaft", "BUERGSCHAFT"],
  ["buergschaft", "BUERGSCHAFT"],
];

const SECOND_SIGNAL = [
  "unterlagen",
  "schufa",
  "gehaltsnachweis",
  "gehaltsabrechnung",
  "selbstauskunft",
  "einkommensnachweis",
  "mietschulden",
  "dokumente",
  "kontoauszug",
  "personalausweis",
  "ausweiskopie",
  "anzahlung",
  "überweisung",
  "ueberweisung",
  "vorauszahlung",
  "paypal",
  "iban",
];

const REFUSED_VIEWING = [
  "keine besichtigung",
  "ohne besichtigung",
  "besichtigung nicht möglich",
  "besichtigung nicht moeglich",
  "nicht vor ort",
  "keine vor-ort",
];

const LINK = /https?:\/\/[^\s<>"']+/i;
const DATE =
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{1,2}\.\s*(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)/i;

export interface ProposedSlot {
  text: string;
  citation: string;
}

export interface ProposedIntent {
  code: string;
  confidence: number;
  summary: string;
  citation: string;
  deepLink: string;
  linkCitation: string;
  requestedDocuments: readonly string[];
  proposedSlots: readonly ProposedSlot[];
}

export interface ProposedFlag {
  code: string;
  citation: string;
}

export interface ProposedTriage {
  intents: readonly ProposedIntent[];
  redFlags: readonly ProposedFlag[];
  relevance?: string;
}

export interface IntentMetadata {
  citation: string;
  actionDeepLink: string | null;
  linkCitation: string | null;
  requestedDocuments: DocumentCode[];
  proposedSlots: ProposedSlot[];
}

export interface KeptIntent {
  code: IntentCode;
  confidence: number;
  summary: string;
  metadata: IntentMetadata;
  dskViolation: boolean;
}

export interface DraftChoice {
  code: IntentCode;
  intent: MailIntent;
  citation: string;
}

export interface TriageDecision {
  intents: KeptIntent[];
  riskLevel: RiskLevel;
  redFlags: RedFlag[];
  priority: Priority | null;
  notify: boolean;
  blocked: boolean;
  draft: DraftChoice | null;
  relevance: Relevance;
}

export function isIntentCode(value: string): value is IntentCode {
  return (INTENT_CODES as readonly string[]).includes(value);
}

export function isDocumentCode(value: string): value is DocumentCode {
  return (DOCUMENT_CODES as readonly string[]).includes(value);
}

export function isPhaseADocument(code: DocumentCode): boolean {
  return PHASE_A_DOCUMENTS.has(code);
}

export function isRedFlag(value: string): value is RedFlag {
  return (RED_FLAGS as readonly string[]).includes(value);
}

export function isRelevance(value: string): value is Relevance {
  return (RELEVANCE_LABELS as readonly string[]).includes(value);
}

export function settleRelevance(raw: string, keptIntents: number): Relevance {
  if (keptIntents > 0) {
    return "possible";
  }
  return raw === "unrelated" ? "unrelated" : "possible";
}

export function draftIntentFor(code: IntentCode): MailIntent | null {
  return DRAFT_INTENT[code];
}

export function dskPhase(stage: FunnelStage | null): "A" | "B" {
  if (stage === "viewing_offered" || stage === "scheduled") {
    return "B";
  }
  return "A";
}

export function priorityRank(priority: Priority): number {
  return PRIORITIES.indexOf(priority);
}

export function rulesSkipModel(subject: string, body: string, classification: MailClassification | null): boolean {
  if (!classification) {
    return false;
  }
  if (portalReceipt(subject, body)) {
    return true;
  }
  if (hasSecondSignal(subject, body)) {
    return false;
  }
  if (quotedRejection(subject, body)) {
    return true;
  }
  if (classification.intent === "cancelled_by_us" || classification.intent === "slot_cancelled") {
    return true;
  }
  return classification.intent === "receipt" || classification.intent === "waitlist";
}

export function proposeFromRules(input: {
  from: string;
  subject: string;
  body: string;
  classification: MailClassification;
}): ProposedTriage {
  if (input.classification.intent === "cancelled_by_us") {
    return { intents: [bare("APPT_CANCELLED_BY_US", input.classification.evidence)], redFlags: [] };
  }
  if (input.classification.intent === "slot_cancelled") {
    return { intents: [bare("APPT_SLOT_CANCELLED", input.classification.evidence)], redFlags: [] };
  }
  const rejection = quotedRejection(input.subject, input.body);
  if (rejection) {
    return { intents: [bare("REJECTION", rejection)], redFlags: [] };
  }
  const intents: ProposedIntent[] = [];
  if (input.classification.intent === "receipt") {
    const code = fromScout(input.from) ? "IS24_AUTO_ACK" : "LANDLORD_WAIT_ACK";
    intents.push(bare(code, input.classification.evidence));
  } else if (input.classification.intent === "waitlist") {
    intents.push(bare("LANDLORD_WAIT_ACK", input.classification.evidence));
  } else {
    const mapped = MAIL_INTENT_CODE[input.classification.intent];
    if (mapped) {
      const corpus = `${input.subject}\n${input.body}`;
      const documents = documentsIn(corpus);
      const disclosure = corpus.toLowerCase().includes("selbstauskunft");
      const code = mapped === "DOC_PACKAGE_REQ" && documents.length === 0 && disclosure ? "SELF_DISCLOSURE_REQ" : mapped;
      intents.push({
        ...bare(code, input.classification.evidence),
        requestedDocuments: code === "DOC_PACKAGE_REQ" ? documents : [],
      });
      if (code === "DOC_PACKAGE_REQ" && disclosure) {
        intents.push(bare("SELF_DISCLOSURE_REQ", "selbstauskunft"));
      }
    }
  }
  const visit = citedVisit(input.body);
  const first = intents[0];
  if (visit?.when && first) {
    first.proposedSlots = [{ text: visit.when, citation: visit.citation }];
  }
  return { intents, redFlags: [] };
}

export function confirmTriage(input: {
  text: string;
  stage: FunnelStage | null;
  proposed: ProposedTriage;
}): TriageDecision {
  const phase = dskPhase(input.stage);
  const kept: KeptIntent[] = [];
  const seen = new Set<IntentCode>();
  for (const intent of input.proposed.intents) {
    if (!isIntentCode(intent.code) || intent.code === "SCAM_SUSPECTED" || seen.has(intent.code)) {
      continue;
    }
    if (!cited(input.text, intent.citation)) {
      continue;
    }
    const documents = intent.requestedDocuments.filter(isDocumentCode);
    const slots = intent.proposedSlots.filter(
      (slot) => slot.text.trim() !== "" && cited(input.text, slot.citation),
    );
    const link = keepLink(input.text, intent.deepLink, intent.linkCitation);
    const dskViolation = phase === "A" && documents.some((code) => PHASE_A_DOCUMENTS.has(code));
    seen.add(intent.code);
    kept.push({
      code: intent.code,
      confidence: clampConfidence(intent.confidence),
      summary: intent.summary.trim().slice(0, 400),
      metadata: {
        citation: intent.citation.trim(),
        actionDeepLink: link?.url ?? null,
        linkCitation: link?.citation ?? null,
        requestedDocuments: documents,
        proposedSlots: slots.map((slot) => ({ text: slot.text.trim(), citation: slot.citation.trim() })),
      },
      dskViolation,
    });
  }
  const redFlags = confirmedFlags(input.text, input.proposed.redFlags);
  const hardBlock =
    redFlags.includes("UPFRONT_PAYMENT_OR_FEE") ||
    redFlags.includes("UNSOLICITED_PASSPORT_SCAN") ||
    (redFlags.includes("LANDLORD_ABROAD") && refusesViewing(input.text));
  const dsk = kept.some((intent) => intent.dskViolation);
  const riskLevel: RiskLevel = hardBlock ? "CRITICAL_SCAM_BLOCK" : dsk ? "WARN_DSGVO_VIOLATION" : "SAFE";
  if (riskLevel !== "SAFE") {
    kept.push(scamIntent(input.proposed, redFlags, riskLevel));
  }
  kept.sort((left, right) => priorityRank(INTENT_PRIORITY[left.code]) - priorityRank(INTENT_PRIORITY[right.code]));
  const priority = kept[0] ? INTENT_PRIORITY[kept[0].code] : null;
  return {
    intents: kept,
    riskLevel,
    redFlags,
    priority,
    notify: priority !== null && priority !== "P3_SILENT",
    blocked: riskLevel === "CRITICAL_SCAM_BLOCK",
    draft: hardBlock ? null : pickDraft(kept),
    relevance: settleRelevance(input.proposed.relevance ?? "", kept.length),
  };
}

export function decisionFromStored(input: {
  intents: readonly {
    code: string;
    confidence: number;
    summary: string;
    metadataJson: string;
    dskViolation: boolean;
  }[];
  riskLevel: string;
  redFlags: readonly string[];
  relevance: string;
}): TriageDecision {
  const intents: KeptIntent[] = [];
  for (const row of input.intents) {
    if (!isIntentCode(row.code)) {
      continue;
    }
    intents.push({
      code: row.code,
      confidence: clampConfidence(row.confidence),
      summary: row.summary,
      metadata: metadataFromJson(row.metadataJson),
      dskViolation: row.dskViolation,
    });
  }
  intents.sort((left, right) => priorityRank(INTENT_PRIORITY[left.code]) - priorityRank(INTENT_PRIORITY[right.code]));
  const redFlags = input.redFlags.filter(isRedFlag);
  const riskLevel: RiskLevel = (RISK_LEVELS as readonly string[]).includes(input.riskLevel)
    ? (input.riskLevel as RiskLevel)
    : "SAFE";
  const blocked = riskLevel === "CRITICAL_SCAM_BLOCK";
  const priority = intents[0] ? INTENT_PRIORITY[intents[0].code] : null;
  return {
    intents,
    riskLevel,
    redFlags,
    priority,
    notify: priority !== null && priority !== "P3_SILENT",
    blocked,
    draft: blocked ? null : pickDraft(intents),
    relevance: settleRelevance(input.relevance, intents.length),
  };
}

export function triageSummary(decision: TriageDecision): string {
  const documents = [...new Set(decision.intents.flatMap((intent) => intent.metadata.requestedDocuments))];
  const link = decision.intents.find((intent) => intent.metadata.actionDeepLink)?.metadata.actionDeepLink ?? "";
  return [decision.riskLevel, decision.redFlags.join(", "), documents.join(", "), link]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" — ");
}

function scamIntent(proposed: ProposedTriage, flags: readonly RedFlag[], riskLevel: RiskLevel): KeptIntent {
  const citedFlag = proposed.redFlags.find((flag) => flags.includes(flag.code as RedFlag) && flag.citation.trim() !== "");
  const citation = citedFlag?.citation.trim() || riskLevel;
  return {
    code: "SCAM_SUSPECTED",
    confidence: 1,
    summary: riskLevel,
    metadata: {
      citation,
      actionDeepLink: null,
      linkCitation: null,
      requestedDocuments: [],
      proposedSlots: [],
    },
    dskViolation: false,
  };
}

function pickDraft(intents: readonly KeptIntent[]): DraftChoice | null {
  for (const intent of intents) {
    const mapped = DRAFT_INTENT[intent.code];
    if (mapped) {
      return { code: intent.code, intent: mapped, citation: intent.metadata.citation };
    }
  }
  return null;
}

function confirmedFlags(text: string, flags: readonly ProposedFlag[]): RedFlag[] {
  const kept: RedFlag[] = [];
  for (const flag of flags) {
    if (!isRedFlag(flag.code) || kept.includes(flag.code) || !cited(text, flag.citation)) {
      continue;
    }
    kept.push(flag.code);
  }
  return kept;
}

function keepLink(text: string, deepLink: string, linkCitation: string): { url: string; citation: string } | null {
  const url = httpUrl(deepLink);
  if (!url) {
    return null;
  }
  if (cited(text, linkCitation)) {
    return { url, citation: linkCitation.trim() };
  }
  if (cited(text, url) || cited(text, deepLink.trim())) {
    return { url, citation: deepLink.trim() };
  }
  return null;
}

function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function cited(text: string, citation: string): boolean {
  const quote = citation.trim();
  return quote !== "" && text.toLowerCase().includes(quote.toLowerCase());
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, scaled));
}

function metadataFromJson(payload: string): IntentMetadata {
  const empty: IntentMetadata = {
    citation: "",
    actionDeepLink: null,
    linkCitation: null,
    requestedDocuments: [],
    proposedSlots: [],
  };
  try {
    const parsed = JSON.parse(payload) as {
      citation?: unknown;
      actionDeepLink?: unknown;
      linkCitation?: unknown;
      requestedDocuments?: unknown;
      proposedSlots?: unknown;
    };
    const documents = Array.isArray(parsed.requestedDocuments)
      ? parsed.requestedDocuments.filter(isDocumentCode)
      : [];
    const slots = Array.isArray(parsed.proposedSlots)
      ? parsed.proposedSlots.flatMap((item) => {
          if (!item || typeof item !== "object") {
            return [];
          }
          const slot = item as { text?: unknown; citation?: unknown };
          if (typeof slot.text !== "string" || typeof slot.citation !== "string" || slot.text.trim() === "") {
            return [];
          }
          return [{ text: slot.text, citation: slot.citation }];
        })
      : [];
    return {
      citation: typeof parsed.citation === "string" ? parsed.citation : "",
      actionDeepLink: typeof parsed.actionDeepLink === "string" ? parsed.actionDeepLink : null,
      linkCitation: typeof parsed.linkCitation === "string" ? parsed.linkCitation : null,
      requestedDocuments: documents,
      proposedSlots: slots,
    };
  } catch {
    return empty;
  }
}

function portalReceipt(subject: string, body: string): boolean {
  const text = `${subject}\n${body}`.toLowerCase().replace(/\s+/g, " ");
  return ["persönliche vorstellung beim anbieter", "kontaktaufnahme wurde erfolgreich verschickt", "anfrage versendet"].some(
    (phrase) => text.includes(phrase),
  );
}

function refusesViewing(text: string): boolean {
  const lower = text.toLowerCase();
  return REFUSED_VIEWING.some((phrase) => lower.includes(phrase));
}

function hasSecondSignal(subject: string, body: string): boolean {
  const corpus = `${subject}\n${body}`.toLowerCase();
  if (LINK.test(body) || DATE.test(corpus)) {
    return true;
  }
  return SECOND_SIGNAL.some((phrase) => corpus.includes(phrase));
}

function documentsIn(text: string): DocumentCode[] {
  const lower = text.toLowerCase();
  const found: DocumentCode[] = [];
  for (const [phrase, code] of DOCUMENT_SIGNALS) {
    if (lower.includes(phrase) && !found.includes(code)) {
      found.push(code);
    }
  }
  if (/\bwbs\b/i.test(text) && !found.includes("WBS")) {
    found.push("WBS");
  }
  return found;
}

export function judgmentCitation(decisionJson: string): string {
  try {
    const parsed = JSON.parse(decisionJson) as {
      intents?: Array<{ code?: unknown; citation?: unknown; requestedDocuments?: unknown }>;
    };
    const intents = Array.isArray(parsed.intents) ? parsed.intents : [];
    const scam = intents.find(
      (intent) => intent.code === "SCAM_SUSPECTED" && typeof intent.citation === "string" && intent.citation.trim() !== "",
    );
    if (scam && typeof scam.citation === "string") {
      return scam.citation.trim();
    }
    const documents = intents.find(
      (intent) =>
        Array.isArray(intent.requestedDocuments) &&
        intent.requestedDocuments.length > 0 &&
        typeof intent.citation === "string" &&
        intent.citation.trim() !== "",
    );
    if (documents && typeof documents.citation === "string") {
      return documents.citation.trim();
    }
    return "";
  } catch {
    return "";
  }
}

function bare(code: IntentCode, citation: string): ProposedIntent {
  return {
    code,
    confidence: 1,
    summary: citation,
    citation,
    deepLink: "",
    linkCitation: "",
    requestedDocuments: [],
    proposedSlots: [],
  };
}
