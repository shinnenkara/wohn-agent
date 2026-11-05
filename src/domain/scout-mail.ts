export const MAIL_KINDS = ["notice", "message_copy", "landlord", "unclassified"] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

export interface ParsedMail {
  exposeId: string;
  kind: MailKind;
  title: string;
  postcode: string;
  rooms: string;
  size: string;
  rent: string;
}

const objekt = /objekt\s+(\d{5,})/i;
const expose = /\/expose\/(\d{5,})/;
const berlin = /\b(\d{5})\s+Berlin\b/g;
const rooms = /(\d+)\s*(?:Zimmer|Zi\.)/;
const sizeRe = /(\d+(?:[.,]\d+)?)\s*m²/;
const rentRe = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*€/g;
const tags = /<[^>]+>/g;

export function parseScoutMail(from: string, subject: string, text: string, html: string): ParsedMail {
  let body = text;
  if (html.trim() !== "") {
    body = `${body}\n${html.replace(tags, "\n")}`;
  }
  body = cutFooter(body);
  berlin.lastIndex = 0;
  rentRe.lastIndex = 0;
  const parsed: ParsedMail = {
    exposeId: exposeId(subject, html, body),
    kind: kind(from, subject),
    title: "",
    postcode: "",
    rooms: first(rooms, body),
    size: first(sizeRe, body),
    rent: nearestRent(body),
  };
  const card = postcodeAndTitle(body);
  parsed.postcode = card.postcode;
  parsed.title = card.title;
  return parsed;
}

export function hasCard(parsed: ParsedMail): boolean {
  return parsed.postcode !== "" || (parsed.rent !== "" && parsed.size !== "");
}

export function fromScout(from: string): boolean {
  let email = from.toLowerCase();
  const bracket = email.lastIndexOf("<");
  if (bracket >= 0) {
    email = email.slice(bracket + 1);
  }
  email = email.replace(/[> ]+$/g, "").trim();
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return email.includes("immobilienscout24.de");
  }
  const domain = email.slice(at + 1);
  return domain === "immobilienscout24.de" || domain.endsWith(".immobilienscout24.de");
}

const CALENDAR_PREFIXES = [
  "invitation:",
  "updated invitation:",
  "canceled event:",
  "cancelled event:",
  "transfer event:",
];

export function calendarNotice(from: string, subject: string, calendarPart: boolean): boolean {
  const sender = from.toLowerCase();
  if (sender.includes("calendar-notification@") || sender.includes("@calendar.google.com")) {
    return true;
  }
  const line = subject.toLowerCase().trim();
  for (const prefix of CALENDAR_PREFIXES) {
    if (line.startsWith(prefix)) {
      return true;
    }
  }
  return calendarPart;
}

function exposeId(subject: string, html: string, body: string): string {
  for (const source of [subject, html, body]) {
    const objectMatch = objekt.exec(source);
    if (objectMatch?.[1]) {
      return objectMatch[1];
    }
    const linkMatch = expose.exec(source);
    if (linkMatch?.[1]) {
      return linkMatch[1];
    }
  }
  return "";
}

function kind(from: string, subject: string): MailKind {
  const sender = from.toLowerCase();
  const line = subject.toLowerCase();
  if (sender.includes("myscout@") || line.includes("anfrage versendet")) {
    return "notice";
  }
  if (line.includes("neue nachricht") || sender.includes("@nachrichten.immobilienscout24.de")) {
    return "message_copy";
  }
  if (sender.includes("@immobilienscout24.de")) {
    return "unclassified";
  }
  return "landlord";
}

function cutFooter(body: string): string {
  const lower = body.toLowerCase();
  let cut = body.length;
  for (const mark of ["invalidenstraße", "invalidenstrasse", "immobilien scout gmbh"]) {
    const index = lower.indexOf(mark);
    if (index >= 0 && index < cut) {
      cut = index;
    }
  }
  return body.slice(0, cut);
}

function postcodeAndTitle(body: string): { postcode: string; title: string } {
  for (const match of body.matchAll(berlin)) {
    const start = match.index ?? 0;
    const windowStart = Math.max(0, start - 180);
    const window = body.slice(windowStart, start + match[0].length).toLowerCase();
    if (window.includes("invaliden") || window.includes("immobilien scout")) {
      continue;
    }
    const code = match[1] ?? "";
    return { postcode: code, title: lineBefore(body, start) };
  }
  return { postcode: "", title: "" };
}

function lineBefore(body: string, index: number): string {
  const lines = body.slice(0, index).split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (line === "" || line.includes("€") || line.length < 8) {
      continue;
    }
    return line;
  }
  return "";
}

function first(pattern: RegExp, body: string): string {
  const match = pattern.exec(body);
  return match?.[1] ?? "";
}

function nearestRent(body: string): string {
  const sizeAt = sizeRe.exec(body);
  const rents = [...body.matchAll(rentRe)];
  const firstRent = rents[0];
  if (!firstRent || firstRent.index === undefined) {
    return "";
  }
  let best = firstRent;
  if (sizeAt?.index !== undefined) {
    let bestDist = Math.abs(firstRent.index - sizeAt.index);
    for (const loc of rents.slice(1)) {
      if (loc.index === undefined) {
        continue;
      }
      const distance = Math.abs(loc.index - sizeAt.index);
      if (distance < bestDist) {
        best = loc;
        bestDist = distance;
      }
    }
  }
  return best[1] ?? "";
}
