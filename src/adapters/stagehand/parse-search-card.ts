import { parseGermanAmount } from "./parse-listing-text.js";

export interface SearchCardFacts {
  title: string | null;
  priceCold: number | null;
  priceWarm: number | null;
  rooms: number | null;
  areaSqm: number | null;
  energyClass: string | null;
  address: string | null;
}

const BADGES = new Set([
  "projekteinheit",
  "neubauprojekt",
  "premium",
  "mieterplus",
  "exposé",
  "expose",
  "neu",
  "verfügbar",
  "verfuegbar",
  "basis",
]);

const STREET = /\b(?:str\.|straße|strasse|weg|platz|allee|damm|ufer|ring|gasse|chaussee)\b/i;
const AMOUNT = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/;
const MAX_THUMBNAIL_BYTES = 48 * 1024;

export function interpretSearchCard(text: string): SearchCardFacts {
  const facts: SearchCardFacts = {
    title: null,
    priceCold: null,
    priceWarm: null,
    rooms: null,
    areaSqm: null,
    energyClass: null,
    address: null,
  };
  const titles: string[] = [];
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const line of lines) {
    if (BADGES.has(line.toLowerCase()) || /^\d{5,}$/.test(line)) {
      continue;
    }
    if (/kaufpreis/i.test(line)) {
      continue;
    }
    const price = priceFromLine(line);
    if (price !== null) {
      if (/warmmiete|gesamtmiete/i.test(line)) {
        facts.priceWarm ??= price;
      } else {
        facts.priceCold ??= price;
      }
      continue;
    }
    const area = areaFromLine(line);
    if (area !== null) {
      facts.areaSqm ??= area;
      continue;
    }
    const rooms = roomsFromLine(line);
    if (rooms !== null) {
      facts.rooms ??= rooms;
      continue;
    }
    const energy = energyFromLine(line);
    if (energy) {
      facts.energyClass ??= energy;
      continue;
    }
    if (isAddress(line)) {
      facts.address ??= line;
      continue;
    }
    titles.push(line);
  }
  facts.title = longest(titles);
  return facts;
}

export function thumbnailUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (!url.pathname.includes("/resize/")) {
    return null;
  }
  url.pathname = url.pathname
    .replace(/\/resize\/[^/]+/, "/resize/320x240>")
    .replace(/\/format\/[^/]+/, "/format/jpeg")
    .replace(/\/quality\/\d+/, "/quality/30");
  return url.toString();
}

export async function readThumbnail(
  raw: string,
  fetchImpl: (url: string, init: { signal: AbortSignal }) => Promise<Response> = fetch,
): Promise<Uint8Array | null> {
  const url = thumbnailUrl(raw);
  if (!url) {
    return null;
  }
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      return null;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_THUMBNAIL_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES || !isJpeg(bytes, response.headers.get("content-type"))) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  }
}

function priceFromLine(line: string): number | null {
  if (!/€|\beur\b|miete/i.test(line)) {
    return null;
  }
  const match = AMOUNT.exec(line);
  const value = match?.[1] ? parseGermanAmount(match[1]) : null;
  if (value === null || value <= 0) {
    return null;
  }
  return value;
}

function areaFromLine(line: string): number | null {
  const match = line.match(/^(?:ca\.\s*)?(\d{1,4}(?:,\d+)?)\s*m(?:²|2)$/i);
  const value = match?.[1] ? parseGermanAmount(match[1]) : null;
  if (value === null || value <= 0 || value > 1000) {
    return null;
  }
  return value;
}

function roomsFromLine(line: string): number | null {
  const match = line.match(/^(?:ca\.\s*)?(\d{1,2}(?:,\d+)?)\s*(?:Zi\.?|Zimmer)\.?$/i);
  const value = match?.[1] ? parseGermanAmount(match[1]) : null;
  if (value === null || value <= 0 || value > 20) {
    return null;
  }
  return value;
}

function energyFromLine(line: string): string | null {
  const only = line.match(/^([A-H])(\+)?$/i);
  if (only) {
    return `${only[1]?.toUpperCase() ?? ""}${only[2] ?? ""}`;
  }
  const labeled = line.match(/energieeffizienz(?:klasse)?\s*[:\-]?\s*([A-H]\+?)\s*$/i);
  return labeled?.[1] ? labeled[1].toUpperCase() : null;
}

function isAddress(line: string): boolean {
  if (line.length < 6 || line.length > 160 || /€|m²|\bzi\b|zimmer/i.test(line)) {
    return false;
  }
  if (STREET.test(line)) {
    return true;
  }
  if (!line.includes(",")) {
    return false;
  }
  const parts = line.split(",").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length >= 2 && parts.every((part) => part.length <= 40 && /\p{L}/u.test(part));
}

function longest(lines: readonly string[]): string | null {
  let best: string | null = null;
  for (const line of lines) {
    if (!best || line.length > best.length) {
      best = line;
    }
  }
  return best;
}

function isJpeg(bytes: Uint8Array, contentType: string | null): boolean {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  return type === "image/jpeg" || type === "image/jpg";
}
