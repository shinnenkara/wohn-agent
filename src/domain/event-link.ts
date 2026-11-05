const objekt = /objekt\s+(\d{5,})/i;
const expose = /\/expose\/(\d{5,})/g;

const MONTHS = [
  "januar",
  "februar",
  "märz",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "dezember",
];

export interface LinkableEvent {
  title: string;
  description: string;
  place: string;
  start: string;
}

export interface LinkableVisit {
  scoutId: string;
  when: string;
  place: string;
  citation: string;
}

export function exposeIdsInText(text: string): string[] {
  const found = new Set<string>();
  expose.lastIndex = 0;
  for (const match of text.matchAll(expose)) {
    if (match[1]) {
      found.add(match[1]);
    }
  }
  const objectMatch = objekt.exec(text);
  if (objectMatch?.[1]) {
    found.add(objectMatch[1]);
  }
  return [...found];
}

export function scoutIdForEvent(event: LinkableEvent, visits: readonly LinkableVisit[]): string | null {
  const explicit = exposeIdsInText(`${event.title}\n${event.description}\n${event.place}`);
  if (explicit.length === 1) {
    return explicit[0] ?? null;
  }
  if (explicit.length > 1) {
    return null;
  }
  const matched = new Set<string>();
  for (const visit of visits) {
    if (visitAgrees(event, visit)) {
      matched.add(visit.scoutId);
    }
  }
  if (matched.size === 1) {
    return [...matched][0] ?? null;
  }
  return null;
}

function visitAgrees(event: LinkableEvent, visit: LinkableVisit): boolean {
  if (!placesAgree(event.place, visit.place)) {
    return false;
  }
  const haystack = `${visit.when}\n${visit.citation}`.toLowerCase();
  return dateCandidates(event.start).some((candidate) => haystack.includes(candidate));
}

function placesAgree(eventPlace: string, visitPlace: string): boolean {
  const left = eventPlace.trim().toLowerCase();
  const right = visitPlace.trim().toLowerCase();
  if (left.length < 4 || right.length < 4) {
    return false;
  }
  return left.includes(right) || right.includes(left);
}

function dateCandidates(start: string): string[] {
  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return numericCandidates(start.slice(0, 4), start.slice(5, 7), start.slice(8, 10));
  }
  if (Number.isNaN(parsed.getTime())) {
    return [];
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = part(parts, "year");
  const month = part(parts, "month");
  const day = part(parts, "day");
  return numericCandidates(year, month, day);
}

function numericCandidates(year: string, month: string, day: string): string[] {
  const monthIndex = Number(month) - 1;
  const monthName = MONTHS[monthIndex] ?? "";
  const dayNumber = String(Number(day));
  const monthNumber = String(Number(month));
  const candidates = [
    `${year}-${month}-${day}`,
    `${day}.${month}.${year}`,
    `${dayNumber}.${monthNumber}.${year}`,
    `${dayNumber}.${month}.${year}`,
  ];
  if (monthName) {
    candidates.push(`${dayNumber}. ${monthName}`);
    candidates.push(`${dayNumber}.${monthName}`);
    if (monthName === "märz") {
      candidates.push(`${dayNumber}. maerz`);
      candidates.push(`${dayNumber}.maerz`);
    }
  }
  return candidates.map((candidate) => candidate.toLowerCase());
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}
