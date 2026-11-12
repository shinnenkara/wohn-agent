export const LINK_METHODS = ["expose", "thread", "references", "address", "model", "manual"] as const;

export type LinkMethod = (typeof LINK_METHODS)[number];

export interface MailCandidate {
  scoutId: string;
  title: string | null;
  address: string | null;
  priceCold: number | null;
}

export interface LinkSignals {
  exposeId: string;
  threadScoutId: string;
  referencedScoutId: string;
  addressMatch: { scoutId: string } | "ambiguous" | null;
}

export function chooseLink(signals: LinkSignals): { scoutId: string; method: LinkMethod | "" } {
  if (signals.exposeId) {
    return { scoutId: signals.exposeId, method: "expose" };
  }
  if (signals.threadScoutId) {
    return { scoutId: signals.threadScoutId, method: "thread" };
  }
  if (signals.referencedScoutId) {
    return { scoutId: signals.referencedScoutId, method: "references" };
  }
  if (signals.addressMatch && signals.addressMatch !== "ambiguous") {
    return { scoutId: signals.addressMatch.scoutId, method: "address" };
  }
  return { scoutId: "", method: "" };
}

export function referencedMessageIds(inReplyTo: string, referencesHeader: string): string[] {
  const found = `${inReplyTo} ${referencesHeader}`.match(/<[^<>\s]+>/g) ?? [];
  return [...new Set(found)];
}

export function normalizeSubject(subject: string): string {
  let value = subject.trim().toLowerCase().replace(/\s+/g, " ");
  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/^(re|aw|fwd|fw|wg)\s*:\s*/, "");
  }
  return value.trim();
}

export function senderDomain(from: string): string {
  let email = from.toLowerCase();
  const bracket = email.lastIndexOf("<");
  if (bracket >= 0) {
    email = email.slice(bracket + 1);
  }
  email = email.replace(/[> ]+$/g, "").trim();
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return "";
  }
  return email.slice(at + 1);
}

export function matchAddress(
  body: string,
  candidates: readonly MailCandidate[],
): { scoutId: string } | "ambiguous" | null {
  const foldedBody = fold(body);
  const zips = new Set([...body.matchAll(/\b(\d{5})\b/g)].map((match) => match[1] ?? ""));
  const rents = euroAmounts(body);
  const hits = new Set<string>();
  for (const candidate of candidates) {
    if (candidateHits(candidate, foldedBody, zips, rents)) {
      hits.add(candidate.scoutId);
    }
  }
  if (hits.size === 1) {
    const scoutId = [...hits][0];
    return scoutId ? { scoutId } : null;
  }
  if (hits.size > 1) {
    return "ambiguous";
  }
  return null;
}

function candidateHits(
  candidate: MailCandidate,
  foldedBody: string,
  zips: ReadonlySet<string>,
  rents: readonly number[],
): boolean {
  if (!streetHits(candidate.address ?? "", foldedBody)) {
    return false;
  }
  const zip = candidate.address?.match(/\b(\d{5})\b/)?.[1];
  if (zip && zips.has(zip)) {
    return true;
  }
  return candidate.priceCold !== null && rents.some((rent) => Math.abs(rent - candidate.priceCold!) < 0.01);
}

function streetHits(address: string, foldedBody: string): boolean {
  const words = fold(address)
    .split(" ")
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word) && word !== "berlin");
  return words.some((word) => foldedBody.includes(word));
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/strasse/g, "str")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function euroAmounts(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*€/g)) {
    const raw = match[1]?.replace(/\./g, "").replace(",", ".");
    const value = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(value)) {
      amounts.push(value);
    }
  }
  return amounts;
}
