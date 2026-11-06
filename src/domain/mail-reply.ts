import { buildGreeting } from "./message-template.js";
import { berlinInstant, berlinParts, type BerlinParts } from "./timing.js";

export const MAIL_INTENTS = [
  "receipt",
  "documents",
  "viewing_schedule",
  "viewing_confirm",
  "viewing_followup",
  "waitlist",
  "contract_schedule",
  "contract_confirm",
  "contract_outcome",
  "unknown",
] as const;

export type MailIntent = (typeof MAIL_INTENTS)[number];

export const MAIL_TOPICS = ["documents", "viewing", "contract", "general"] as const;

export type MailTopic = (typeof MAIL_TOPICS)[number];

export const MAIL_RELATIONS = ["start", "continue", "close"] as const;

export type MailRelation = (typeof MAIL_RELATIONS)[number];

export interface OpenTopic {
  topic: MailTopic;
  relation: MailRelation;
}

export interface MailClassification {
  intent: MailIntent;
  relation: MailRelation | null;
  topic: MailTopic | null;
  evidence: string;
}

export interface CitedSlot {
  when: string;
  place: string;
  citation: string;
}

export interface BusyInterval {
  start: string;
  end: string;
}

export interface DraftText {
  body: string;
  altBody: string;
}

export const COMPOSE_URL_LIMIT = 1800;

const CONTINUE_PHRASES = [
  "fehlt noch",
  "fehlen noch",
  "nachreichen",
  "zusätzlich",
  "leider passt",
  "geht auch",
  "alternativ",
  "anderer termin",
  "verschieben",
];

const SOFT_PHRASES = [
  "melden uns",
  "kommen auf sie zu",
  "wir prüfen",
  "zur kenntnis genommen",
  "wir haben ihre nachricht",
];

const REJECTION_PHRASES = [
  "bereits vergeben",
  "schon vergeben",
  "wohnung ist vergeben",
  "leider absagen",
  "wir müssen absagen",
  "nicht berücksichtigt",
  "anderer bewerber",
  "an einen anderen mieter",
  "leider nicht erfolgreich",
];

const QUIET_PHRASES = ["melden uns", "kommen auf sie zu", "wir prüfen", "zur kenntnis genommen"];

const ASK_PHRASES = [
  "bitte",
  "schicken sie",
  "senden sie",
  "reichen sie",
  "laden sie",
  "wann ",
  "fehlt noch",
  "fehlen noch",
  "nachreichen",
  "zusätzlich",
];

const RECEIPT_PHRASES = [
  "anfrage erhalten",
  "eingangsbestätigung",
  "anfrage ist eingegangen",
  "wir haben ihre anfrage",
  "bewerbung erhalten",
  "vielen dank für ihre bewerbung",
  "vielen dank für ihre anfrage",
];

const DOCUMENT_PHRASES = [
  "unterlagen",
  "schufa",
  "gehaltsnachweis",
  "gehaltsabrechnung",
  "selbstauskunft",
  "einkommensnachweis",
  "mietschulden",
  "dokumente",
];

const VIEWING_PHRASES = ["besichtigungstermin", "besichtigung", "besichtigen"];

const FOLLOWUP_PHRASES = [
  "noch interessiert",
  "weiterhin interessiert",
  "nach der besichtigung",
  "wie hat ihnen die besichtigung",
  "wie war die besichtigung",
];

const WAITLIST_PHRASES = ["warteliste", "warte liste"];

const CONTRACT_PHRASES = ["mietvertrag", "vertragsunterzeichnung", "vertragstermin", "zum vertrag", "den vertrag"];

const OUTCOME_PHRASES = [
  "zusage oder absage",
  "absage oder zusage",
  "vertrag annehmen",
  "nehmen sie die wohnung",
  "möchten sie den vertrag",
  "angebot annehmen",
];

const SCHEDULE_PHRASES = [
  "wann können",
  "wann passt",
  "terminvorschlag",
  "termine nennen",
  "zeitfenster",
  "welche termine",
  "schlagen sie",
  "möglichen termine",
  "möglichen zeiten",
];

const MONTH_DATE =
  /\b(\d{1,2}\.\s*(?:januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)(?:\s+\d{4})?)\b/i;
const NUMERIC_DATE = /\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/;
const CLOCK_TIME = /\b(\d{1,2}(?::\d{2})?\s*uhr)\b/i;
const STREET =
  /\b([\p{L}.'’-]+(?:str\.|straße|strasse|weg|platz|allee|damm|ufer|ring)\s*\d+[\p{L}\d/-]*)/iu;
const LINK = /https?:\/\/[^\s<>"']+/i;

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function isMailIntent(value: string): value is MailIntent {
  return (MAIL_INTENTS as readonly string[]).includes(value);
}

export function isMailTopic(value: string): value is MailTopic {
  return (MAIL_TOPICS as readonly string[]).includes(value);
}

export function isMailRelation(value: string): value is MailRelation {
  return (MAIL_RELATIONS as readonly string[]).includes(value);
}

export function topicOfIntent(intent: string): MailTopic | null {
  switch (intent) {
    case "documents":
      return "documents";
    case "viewing_schedule":
    case "viewing_confirm":
    case "viewing_followup":
      return "viewing";
    case "contract_schedule":
    case "contract_confirm":
    case "contract_outcome":
      return "contract";
    case "unknown":
    case "waitlist":
    case "receipt":
      return null;
    default:
      return null;
  }
}

export function classifyReply(subject: string, body: string, open: OpenTopic | null): MailClassification | null {
  const text = haystack(subject, body);
  const rejection = findPhrase(text, REJECTION_PHRASES);
  if (rejection) {
    return closeTopic(open, rejection);
  }
  const found = milestone(text, body);
  const continuation = findPhrase(text, CONTINUE_PHRASES) || findPhrase(text, SOFT_PHRASES);
  if (found?.intent === "waitlist" || found?.intent === "contract_outcome") {
    return applyMilestone(open, found);
  }
  if (found && isCloseIntent(found.intent) && !continuation) {
    return applyMilestone(open, found);
  }
  if (found?.intent === "receipt" && !continuation) {
    return { intent: "receipt", relation: null, topic: null, evidence: found.evidence };
  }
  if (continuation && open && (!found || found.intent === "receipt" || sameTopic(found.intent, open))) {
    const intent = found && found.intent !== "receipt" ? found.intent : intentForTopic(open.topic);
    return { intent, relation: "continue", topic: open.topic, evidence: found?.evidence || continuation };
  }
  if (!found && continuation) {
    return { intent: "unknown", relation: "continue", topic: "general", evidence: continuation };
  }
  if (!found) {
    return null;
  }
  return applyMilestone(open, found);
}

export function settleReply(
  open: OpenTopic | null,
  intentRaw: string,
  evidence: string,
  subject: string,
  body: string,
): MailClassification {
  let intent: MailIntent = isMailIntent(intentRaw) ? intentRaw : "unknown";
  const quote = evidence.trim();
  if (intent !== "unknown" && (quote === "" || !body.toLowerCase().includes(quote.toLowerCase()))) {
    intent = "unknown";
  }
  if (intent === "unknown") {
    return { intent: "unknown", relation: null, topic: null, evidence: "" };
  }
  return applyMilestone(open, { intent, evidence: quote });
}

export function nextTopic(current: OpenTopic | null, classification: MailClassification): OpenTopic | null {
  if (!classification.relation || !classification.topic) {
    return current;
  }
  return { topic: classification.topic, relation: classification.relation };
}

export function citedVisit(body: string): CitedSlot | null {
  const when = citedWhen(body);
  const place = citedPlace(body);
  if (!when && !place) {
    return null;
  }
  return { when, place, citation: [when, place].filter(Boolean).join(" ") };
}

export function eveningSlots(now: Date, busy: readonly BusyInterval[], limit = 3): Date[] {
  const slots: Date[] = [];
  const origin = berlinParts(now);
  for (let offset = 0; offset < 14 && slots.length < limit; offset += 1) {
    const day = addDays(origin, offset);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    const start = berlinInstant({ ...day, hour: 18, minute: 0, second: 0 });
    if (start.getTime() <= now.getTime()) {
      continue;
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    if (busy.some((interval) => overlaps(start, end, interval))) {
      continue;
    }
    slots.push(start);
  }
  return slots;
}

export function formatEvening(date: Date): string {
  const parts = berlinParts(date);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const month = MONTHS[parts.month - 1] ?? "";
  return `${WEEKDAYS[weekday] ?? ""}, ${parts.day}. ${month}, ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function renderDraft(input: {
  classification: MailClassification;
  subject: string;
  body: string;
  contactName: string | null;
  slots: readonly Date[];
  visit: CitedSlot | null;
}): DraftText | null {
  const text = haystack(input.subject, input.body);
  if (findPhrase(text, REJECTION_PHRASES)) {
    return null;
  }
  const intent = input.classification.intent;
  if (intent === "receipt" || intent === "unknown") {
    return null;
  }
  if (input.classification.relation === "continue" && quiet(text)) {
    return null;
  }
  if (intent === "viewing_confirm" || intent === "contract_confirm") {
    return confirmDraft(input.contactName, intent, input.visit);
  }
  if (intent === "viewing_schedule" || intent === "contract_schedule") {
    return { body: letter(input.contactName, scheduleParagraph(intent, input.slots)), altBody: "" };
  }
  if (intent === "documents") {
    return { body: letter(input.contactName, documentParagraph(input.body)), altBody: "" };
  }
  if (intent === "waitlist") {
    return {
      body: letter(input.contactName, "Vielen Dank für die Rückmeldung. Ich bleibe gerne auf der Warteliste."),
      altBody: "",
    };
  }
  if (intent === "viewing_followup") {
    return {
      body: letter(input.contactName, "Vielen Dank für die Besichtigung. Ich bin weiterhin interessiert."),
      altBody: letter(input.contactName, "Vielen Dank für die Besichtigung. Ich ziehe meine Bewerbung zurück."),
    };
  }
  if (intent === "contract_outcome") {
    return {
      body: letter(input.contactName, "Vielen Dank. Ich nehme das Angebot an."),
      altBody: letter(input.contactName, "Vielen Dank für die Rückmeldung. Ich möchte den Vertrag nicht abschließen."),
    };
  }
  return null;
}

export function senderName(from: string): string {
  const trimmed = from.trim();
  const bracket = trimmed.lastIndexOf("<");
  if (bracket <= 0) {
    return "";
  }
  return trimmed.slice(0, bracket).replace(/"/g, "").trim();
}

export function mailboxAddress(replyTo: string, from: string): string {
  return emailAddress(replyTo) || emailAddress(from);
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed ? `Re: ${trimmed}` : "Re:";
}

export function gmailComposeUrl(input: { account: string | null; to: string; subject: string; body: string }): string {
  const to = input.to.trim();
  if (!to || input.body.trim() === "") {
    return "";
  }
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("tf", "1");
  const account = input.account?.trim() ?? "";
  if (account) {
    url.searchParams.set("authuser", account);
  }
  url.searchParams.set("to", to);
  url.searchParams.set("su", replySubject(input.subject));
  url.searchParams.set("body", input.body);
  if (url.href.length > COMPOSE_URL_LIMIT) {
    return "";
  }
  return url.href;
}

function applyMilestone(open: OpenTopic | null, found: { intent: MailIntent; evidence: string }): MailClassification {
  if (found.intent === "receipt") {
    return { intent: "receipt", relation: null, topic: null, evidence: found.evidence };
  }
  if (found.intent === "waitlist") {
    const topic = open?.topic ?? "general";
    return { intent: "waitlist", relation: "close", topic, evidence: found.evidence };
  }
  const topic = topicOfIntent(found.intent);
  if (!topic) {
    return { intent: found.intent, relation: null, topic: null, evidence: found.evidence };
  }
  if (isCloseIntent(found.intent)) {
    return { intent: found.intent, relation: "close", topic, evidence: found.evidence };
  }
  if (open && open.topic === topic && open.relation !== "close") {
    return { intent: found.intent, relation: "continue", topic, evidence: found.evidence };
  }
  return { intent: found.intent, relation: "start", topic, evidence: found.evidence };
}

function closeTopic(open: OpenTopic | null, evidence: string): MailClassification {
  const topic = open?.topic ?? "general";
  return { intent: intentForTopic(topic), relation: "close", topic, evidence };
}

function sameTopic(intent: MailIntent, open: OpenTopic): boolean {
  if (intent === "waitlist") {
    return true;
  }
  return topicOfIntent(intent) === open.topic;
}

function intentForTopic(topic: MailTopic): MailIntent {
  switch (topic) {
    case "documents":
      return "documents";
    case "viewing":
      return "viewing_schedule";
    case "contract":
      return "contract_schedule";
    case "general":
      return "unknown";
  }
}

function isCloseIntent(intent: MailIntent): boolean {
  return intent === "viewing_confirm" || intent === "contract_confirm" || intent === "contract_outcome";
}

function milestone(text: string, body: string): { intent: MailIntent; evidence: string } | null {
  const outcome = findPhrase(text, OUTCOME_PHRASES);
  if (outcome) {
    return { intent: "contract_outcome", evidence: outcome };
  }
  const waitlist = findPhrase(text, WAITLIST_PHRASES);
  if (waitlist) {
    return { intent: "waitlist", evidence: waitlist };
  }
  const followup = findPhrase(text, FOLLOWUP_PHRASES);
  if (followup) {
    return { intent: "viewing_followup", evidence: followup };
  }
  const contract = findPhrase(text, CONTRACT_PHRASES);
  const viewing = findPhrase(text, VIEWING_PHRASES);
  const schedule = findPhrase(text, SCHEDULE_PHRASES);
  const when = citedWhen(body);
  if (contract && when) {
    return { intent: "contract_confirm", evidence: when };
  }
  if (contract || (schedule && text.includes("vertrag"))) {
    return { intent: "contract_schedule", evidence: contract || schedule };
  }
  if (viewing && when) {
    return { intent: "viewing_confirm", evidence: when };
  }
  if (viewing || schedule) {
    return { intent: "viewing_schedule", evidence: viewing || schedule };
  }
  const documents = findPhrase(text, DOCUMENT_PHRASES);
  if (documents) {
    return { intent: "documents", evidence: documents };
  }
  const receipt = findPhrase(text, RECEIPT_PHRASES);
  if (receipt) {
    return { intent: "receipt", evidence: receipt };
  }
  return null;
}

function quiet(text: string): boolean {
  if (!findPhrase(text, QUIET_PHRASES)) {
    return false;
  }
  return !findPhrase(text, ASK_PHRASES);
}

function confirmDraft(contactName: string | null, intent: MailIntent, visit: CitedSlot | null): DraftText | null {
  const when = visit?.when.trim() ?? "";
  const place = visit?.place.trim() ?? "";
  if (!when && !place) {
    return null;
  }
  const parts = [when ? `am ${when}` : "", place ? `in ${place}` : ""].filter(Boolean);
  const noun = intent === "contract_confirm" ? "Termin zur Vertragsunterzeichnung" : "Besichtigungstermin";
  return { body: letter(contactName, `Ich bestätige den ${noun} ${parts.join(" ")}.`), altBody: "" };
}

function scheduleParagraph(intent: MailIntent, slots: readonly Date[]): string {
  const noun = intent === "contract_schedule" ? "zur Vertragsunterzeichnung" : "zur Besichtigung";
  if (slots.length === 0) {
    return `Gerne komme ich ${noun}. Bitte nennen Sie mir ein paar mögliche Zeiten.`;
  }
  const lines = slots.map((slot) => `- ${formatEvening(slot)}`);
  return `Gerne komme ich ${noun}.\nMir passen folgende Zeiten:\n${lines.join("\n")}\nBitte sagen Sie mir, welcher Termin passt.`;
}

function documentParagraph(body: string): string {
  const link = uploadLink(body);
  if (link) {
    return `Gerne lade ich die Unterlagen (SCHUFA, Gehaltsnachweise und Selbstauskunft) hier hoch: ${link}`;
  }
  return "Gerne sende ich Ihnen die Unterlagen (SCHUFA, Gehaltsnachweise und Selbstauskunft).";
}

function uploadLink(body: string): string {
  const match = body.match(LINK);
  if (!match) {
    return "";
  }
  const url = match[0].replace(/[).,]+$/, "");
  if (url.toLowerCase().includes("immobilienscout24.de")) {
    return "";
  }
  return url;
}

function letter(contactName: string | null, paragraph: string): string {
  return `${buildGreeting(contactName)}\n\n${paragraph}`;
}

function citedWhen(body: string): string {
  const month = MONTH_DATE.exec(body);
  const numeric = month?.[1] ? "" : (NUMERIC_DATE.exec(body)?.[1] ?? "");
  const date = (month?.[1] ?? numeric).replace(/\s+/g, " ").trim();
  if (!date) {
    return "";
  }
  const time = CLOCK_TIME.exec(body);
  if (!time?.[1]) {
    return date;
  }
  return `${date}, ${time[1].replace(/\s+/g, " ").trim()}`;
}

function citedPlace(body: string): string {
  const match = STREET.exec(body);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function haystack(subject: string, body: string): string {
  return `${subject}\n${body}`.toLowerCase().replace(/\s+/g, " ");
}

function findPhrase(text: string, phrases: readonly string[]): string {
  return phrases.find((phrase) => text.includes(phrase)) ?? "";
}

function overlaps(start: Date, end: Date, interval: BusyInterval): boolean {
  const busyStart = Date.parse(interval.start);
  const busyEnd = Date.parse(interval.end);
  if (Number.isNaN(busyStart) || Number.isNaN(busyEnd)) {
    return false;
  }
  return busyStart < end.getTime() && busyEnd > start.getTime();
}

function addDays(parts: BerlinParts, days: number): BerlinParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function emailAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const bracket = trimmed.match(/<([^>]+)>/);
  const raw = (bracket?.[1] ?? trimmed).trim();
  return raw.includes("@") ? raw : "";
}
