import type { ExposeFacts } from "../../application/ports/browser-session.js";

export interface RawExpose {
  title: string;
  contactName: string | null;
  description: string;
  bodyText: string;
  addressText?: string | null;
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
    address: addressFrom(body, raw.addressText),
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

const STREET = /str\.|straße|strasse|allee|\b(?:weg|platz|damm|ufer|ring|gasse|chaussee)\b/i;
const PLACE = String.raw`\p{L}[\p{L}.'’\-]*(?:\s+\p{L}[\p{L}.'’\-]*){0,3}`;
const CITY = new RegExp(String.raw`^\d{5}\s+${PLACE}$`, "u");
const DISTRICT = new RegExp(String.raw`^${PLACE},\s*\d{5}\s+${PLACE}$`, "u");
const QUARTER = new RegExp(String.raw`^${PLACE},\s*${PLACE}$`, "u");

export function looksLikeAddress(line: string): boolean {
  return addressKind(line) !== null;
}

export function addressFrom(body: string, explicit?: string | null): string | null {
  const fromElement = bestAddress(explicit ?? "", true);
  if (fromElement) {
    return fromElement;
  }
  const labeled = textAfter(body, ["Adresse", "Anschrift"]);
  if (labeled && looksLikeAddress(labeled)) {
    return clip(labeled);
  }
  return bestAddress(body, false);
}

function bestAddress(text: string, allowStreet: boolean): string | null {
  let best: string | null = null;
  let bestRank = 4;
  for (const line of text.split(/\r?\n/)) {
    const rank = addressRank(line, allowStreet);
    if (rank < bestRank) {
      best = line;
      bestRank = rank;
    }
  }
  return best ? clip(best) : null;
}

function addressRank(line: string, allowStreet: boolean): number {
  const kind = addressKind(line);
  if (kind === "postcode") {
    const text = line.replace(/\s+/g, " ").trim();
    if (STREET.test(text)) {
      return 0;
    }
    if (DISTRICT.test(text)) {
      return 1;
    }
    return 2;
  }
  if (kind === "place") {
    return 3;
  }
  if (kind === "street" && allowStreet) {
    return 4;
  }
  return 5;
}

function addressKind(line: string): "postcode" | "place" | "street" | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (text.length < 6 || text.length > 200 || /invaliden/i.test(text) || /€|m²|\bzi\b|\bzimmer\b/i.test(text)) {
    return null;
  }
  if (CITY.test(text) || DISTRICT.test(text) || (STREET.test(text) && /\b\d{5}\b/.test(text))) {
    return "postcode";
  }
  if (QUARTER.test(text)) {
    return "place";
  }
  if (STREET.test(text)) {
    return "street";
  }
  return null;
}

function clip(line: string): string {
  return line.replace(/\s+/g, " ").trim().slice(0, 200);
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
