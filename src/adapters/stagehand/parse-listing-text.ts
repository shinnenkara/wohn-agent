import type { ExposeFacts } from "../../application/ports/browser-session.js";

export interface RawExpose {
  title: string;
  contactName: string | null;
  description: string;
  bodyText: string;
  hasMessageButton: boolean;
  hasExternalLink: boolean;
  hasPhoneOnly: boolean;
}

export function uniqueScoutIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!/^\d{6,}$/.test(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function parseGermanAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/[^\d,.-]/g, "");
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(/\.(?=\d{3}(?:\D|$))/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function interpretExpose(raw: RawExpose): ExposeFacts {
  const body = raw.bodyText;
  const title = raw.title.trim();
  const description = raw.description.trim().slice(0, DESCRIPTION_LIMIT);
  const contactName = interpretContactName(raw.contactName, body);
  return {
    title,
    contactName,
    description,
    priceCold: moneyAfter(body, ["Nettokaltmiete", "Kaltmiete"]),
    priceWarm: moneyAfter(body, ["Warmmiete", "Gesamtmiete"]),
    extraCosts: moneyAfter(body, ["Nebenkosten"]),
    deposit: textAfter(body, ["Kaution", "Genossenschaftsanteile"]),
    rooms: roomsFrom(body),
    areaSqm: areaFrom(body),
    floor: textAfter(body, ["Etage", "Geschoss"]),
    moveIn: textAfter(body, ["Bezugsfrei ab", "Bezugsfrei", "Verfügbar ab", "Verfuegbar ab"]),
    address: addressFrom(body),
    snapshot: body.slice(0, SNAPSHOT_LIMIT),
    isPlusOnly: /nur mit mieter\s*plus|exklusiv für mieter\s*plus|exklusiv fuer mieter\s*plus/i.test(body),
    externalPortal: !raw.hasMessageButton && (raw.hasExternalLink || raw.hasPhoneOnly),
  };
}

const DESCRIPTION_LIMIT = 8_000;
const SNAPSHOT_LIMIT = 20_000;

function roomsFrom(body: string): number | null {
  const labeled = countWithin(textAfter(body, ["Anzahl der Zimmer", "Anzahl Zimmer", "Zimmer"]), 20);
  if (labeled !== null) {
    return labeled;
  }
  return countWithin(firstMatch(body, /(?<!\d)(\d{1,2}(?:,\d+)?)(?!\d)\s*Zimmer/i), 20);
}

function areaFrom(body: string): number | null {
  const labeled = countWithin(textAfter(body, ["Wohnfläche", "Wohnflaeche"]), 1000);
  if (labeled !== null) {
    return labeled;
  }
  return countWithin(firstMatch(body, /(?<!\d)(\d{1,4}(?:,\d+)?)(?!\d)\s*m²/i), 1000);
}

function moneyAfter(body: string, labels: readonly string[]): number | null {
  const text = textAfter(body, labels);
  if (!text) {
    return null;
  }
  const match = text.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/);
  const value = match?.[1] ? parseGermanAmount(match[1]) : null;
  if (value === null) {
    return null;
  }
  if (!text.includes("€") && value >= 1900 && value <= 2100 && Number.isInteger(value)) {
    return null;
  }
  return value;
}

function addressFrom(body: string): string | null {
  const labeled = textAfter(body, ["Adresse", "Anschrift"]);
  if (labeled && !/invaliden/i.test(labeled)) {
    return labeled;
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (/\b\d{5}\s+Berlin\b/.test(line) && !/invaliden/i.test(line) && line.length <= 160) {
      return line;
    }
  }
  return null;
}

function textAfter(body: string, labels: readonly string[]): string | null {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const ordered = [...labels].sort((left, right) => right.length - left.length);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const label of ordered) {
      const pattern = new RegExp(`^${escapeRegExp(label)}\\b[:\\s-]*`, "i");
      if (!pattern.test(line)) {
        continue;
      }
      const rest = line.replace(pattern, "").trim();
      const value = (rest || lines[index + 1] || "").trim();
      if (value && !ordered.some((item) => new RegExp(`^${escapeRegExp(item)}\\b`, "i").test(value))) {
        return value.slice(0, 200);
      }
    }
  }
  return null;
}

function countWithin(raw: string | null, max: number): number | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/(\d{1,4}(?:,\d+)?)/);
  const value = match?.[1] ? parseGermanAmount(match[1]) : null;
  if (value === null || value <= 0 || value > max) {
    return null;
  }
  return value;
}

function firstMatch(body: string, pattern: RegExp): string | null {
  return pattern.exec(body)?.[1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function interpretContactName(explicit: string | null, body: string): string | null {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  const match = body.match(/(?:Frau|Herr)\s+[A-ZÄÖÜ][\p{L}'-]{1,40}/u);
  return match?.[0] ?? null;
}
