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
  const description = (raw.description.trim() || body).slice(0, 8000);
  const contactName = interpretContactName(raw.contactName, body);
  const priceMatch = body.match(
    /Kaltmiete[\s\S]{0,40}?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/i,
  );
  const roomsMatch = body.match(/(\d+(?:,\d+)?)\s*Zimmer/i);
  const areaMatch = body.match(/(\d+(?:,\d+)?)\s*m²/i);
  return {
    title,
    contactName,
    description,
    priceCold: priceMatch?.[1] ? parseGermanAmount(priceMatch[1]) : null,
    rooms: roomsMatch?.[1] ? parseGermanAmount(roomsMatch[1]) : null,
    areaSqm: areaMatch?.[1] ? parseGermanAmount(areaMatch[1]) : null,
    isPlusOnly: /nur mit mieter\s*plus|exklusiv für mieter\s*plus|exklusiv fuer mieter\s*plus/i.test(body),
    externalPortal: !raw.hasMessageButton && (raw.hasExternalLink || raw.hasPhoneOnly),
  };
}

function interpretContactName(explicit: string | null, body: string): string | null {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  const match = body.match(/(?:Frau|Herr)\s+[A-ZÄÖÜ][\p{L}'-]{1,40}/u);
  return match?.[0] ?? null;
}
