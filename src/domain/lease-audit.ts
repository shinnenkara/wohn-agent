export const MIN_LEASE_TEXT = 400;
export const NO_LEASE_TEXT = "No text extracted.";

export interface StaffelStep {
  amount: string;
  citation: string;
}

export interface ProposedLeaseFacts {
  coldRentEur: number | null;
  coldRentCitation: string;
  indexCitation: string;
  capCitation: string;
  staffelSteps: readonly StaffelStep[];
  fixedTermCitation: string;
  fixedTermReason: string;
  furnitureSurchargeEur: number | null;
  furnitureSurchargeCitation: string;
  furnitureValueEur: number | null;
  furnitureValueCitation: string;
  depositEur: number | null;
  depositCitation: string;
  iban: string;
  ibanCitation: string;
  renovationCitations: readonly string[];
}

export interface LeaseScorecard {
  lines: string[];
}

const VALID_REASON: ReadonlyArray<readonly [RegExp, string]> = [
  [/eigenbedarf/i, "Eigenbedarf"],
  [/werkswohnung|betriebswohnung/i, "Werkswohnung"],
  [/instandsetzung|modernisierung|renovierung/i, "Instandsetzung"],
];

export function emptyLeaseFacts(): ProposedLeaseFacts {
  return {
    coldRentEur: null,
    coldRentCitation: "",
    indexCitation: "",
    capCitation: "",
    staffelSteps: [],
    fixedTermCitation: "",
    fixedTermReason: "",
    furnitureSurchargeEur: null,
    furnitureSurchargeCitation: "",
    furnitureValueEur: null,
    furnitureValueCitation: "",
    depositEur: null,
    depositCitation: "",
    iban: "",
    ibanCitation: "",
    renovationCitations: [],
  };
}

export function leaseTextUsable(text: string): boolean {
  return text.trim().length >= MIN_LEASE_TEXT;
}

export function scorecardText(card: LeaseScorecard): string {
  return card.lines.join("\n");
}

export function ibansIn(text: string): string[] {
  const found: string[] = [];
  for (const start of text.matchAll(/[A-Z]{2}\s*\d{2}/gi)) {
    const iban = readIban(text, start.index ?? 0);
    if (iban && !found.includes(iban)) {
      found.push(iban);
    }
  }
  return found;
}

export function auditLease(facts: ProposedLeaseFacts, contractText: string, priorIbans: readonly string[]): LeaseScorecard {
  const lines: string[] = [];
  const cold = citedAmount(contractText, facts.coldRentEur, facts.coldRentCitation);
  const deposit = citedAmount(contractText, facts.depositEur, facts.depositCitation);
  if (cited(contractText, facts.indexCitation)) {
    lines.push(cited(contractText, facts.capCitation) ? "Indexmiete mit genannter Obergrenze." : "Indexmiete ohne Obergrenze.");
  }
  const steps = facts.staffelSteps.filter((step) => step.amount.trim() !== "" && cited(contractText, step.citation));
  if (steps.length > 0) {
    lines.push(`Staffelmiete: ${steps.map((step) => step.amount.trim()).join("; ")}.`);
  }
  if (cited(contractText, facts.fixedTermCitation)) {
    const reason = facts.fixedTermReason.trim();
    const known = reason !== "" && cited(contractText, reason) ? legalReason(reason) : null;
    lines.push(known ? `Befristung: ${known}.` : "Befristung ohne gesetzlichen Grund.");
  }
  if (deposit == null || cold == null) {
    lines.push("Kaution: nicht geprüft.");
  } else if (cents(deposit) > cents(cold) * 3) {
    lines.push(`Kaution ${euro(deposit)} € liegt über 3 × ${euro(cold)} €.`);
  } else {
    lines.push("Kaution innerhalb von 3 Nettokaltmieten.");
  }
  lines.push(...ibanLines(citedIban(contractText, facts.iban, facts.ibanCitation), priorIbans));
  const renovation = facts.renovationCitations.filter((sentence) => cited(contractText, sentence));
  if (renovation.some((sentence) => renovationKind(sentence) === "rigid")) {
    lines.push("Starre Schönheitsreparaturen.");
  }
  if (renovation.some((sentence) => renovationKind(sentence) === "unrenovated")) {
    lines.push("Renovierungspflicht bei unrenovierter Übergabe.");
  }
  const surcharge = citedAmount(contractText, facts.furnitureSurchargeEur, facts.furnitureSurchargeCitation);
  const furniture = citedAmount(contractText, facts.furnitureValueEur, facts.furnitureValueCitation);
  if (surcharge != null && furniture != null) {
    const allowed = furniture / 120;
    lines.push(
      cents(surcharge) > Math.round(allowed * 100)
        ? `Möblierungszuschlag ${euro(surcharge)} € über der 10-Jahres-Abschreibung von ${euro(allowed)} €. Rüge innerhalb von 30 Monaten.`
        : "Möblierungszuschlag innerhalb der 10-Jahres-Abschreibung. Rüge innerhalb von 30 Monaten.",
    );
  } else if (surcharge != null) {
    lines.push("Möblierungszuschlag ohne Abschreibungsgrundlage. Rüge innerhalb von 30 Monaten.");
  }
  lines.push("Mietpreisbremse: nicht geprüft.");
  return { lines };
}

function ibanLines(iban: string | null, priorIbans: readonly string[]): string[] {
  if (!iban) {
    return ["IBAN: nicht genannt."];
  }
  const lines: string[] = [];
  const prior = [...new Set(priorIbans.map(normalizeIban).filter((item) => item.length >= 15))];
  if (!iban.startsWith("DE")) {
    lines.push(`IBAN ${iban} ist keine deutsche IBAN.`);
  }
  if (prior.length === 0) {
    if (iban.startsWith("DE")) {
      lines.push("IBAN: kein Abgleich möglich.");
    }
  } else if (prior.every((item) => item !== iban)) {
    lines.push(`IBAN ${iban} weicht von ${prior[0] ?? ""} ab.`);
  } else {
    lines.push("IBAN stimmt mit früheren Mails überein.");
  }
  return lines;
}

function readIban(text: string, index: number): string | null {
  let cursor = index;
  let compact = "";
  while (cursor < text.length && compact.length < 34) {
    const char = text[cursor] ?? "";
    if (/[A-Za-z0-9]/.test(char)) {
      compact += char.toUpperCase();
      cursor += 1;
      continue;
    }
    if (!/\s/.test(char)) {
      break;
    }
    const gap = text.slice(cursor).match(/^\s+/)?.[0].length ?? 1;
    const token = text.slice(cursor + gap).match(/^[A-Za-z0-9]+/)?.[0] ?? "";
    if (!token || (compact.length >= 15 && !/\d/.test(token))) {
      break;
    }
    cursor += gap;
  }
  if (compact.length < 15 || compact.length > 34) {
    return null;
  }
  return compact;
}

function legalReason(reason: string): string | null {
  for (const [pattern, label] of VALID_REASON) {
    if (pattern.test(reason)) {
      return label;
    }
  }
  return null;
}

function renovationKind(sentence: string): "rigid" | "unrenovated" | null {
  const lower = fold(sentence);
  const beauty = lower.includes("schoenheitsreparatur");
  const rigid = lower.includes("mindestens") || lower.includes("spaetestens");
  if (beauty && rigid) {
    return "rigid";
  }
  const unrenovated = lower.includes("unrenoviert") || lower.includes("nicht renoviert") || lower.includes("ohne renovierung");
  const duty = beauty || lower.includes("renovier") || lower.includes("streichen");
  if (unrenovated && duty) {
    return "unrenovated";
  }
  return null;
}

function citedAmount(text: string, amount: number | null, citation: string): number | null {
  if (amount == null || !Number.isFinite(amount) || !cited(text, citation) || !mentionsAmount(citation, amount)) {
    return null;
  }
  return amount;
}

function citedIban(text: string, iban: string, citation: string): string | null {
  const normal = normalizeIban(iban);
  if (normal.length < 15 || !cited(text, citation)) {
    return null;
  }
  if (!normalizeIban(citation).includes(normal)) {
    return null;
  }
  return normal;
}

function cited(text: string, citation: string): boolean {
  const quote = citation.trim();
  return quote !== "" && text.toLowerCase().includes(quote.toLowerCase());
}

function mentionsAmount(citation: string, amount: number): boolean {
  const digits = String(Math.trunc(Math.abs(amount)));
  return citation.replace(/\./g, "").replace(/\s+/g, "").includes(digits);
}

function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function cents(euros: number): number {
  return Math.round(euros * 100);
}

function euro(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace(/0$/, "");
}

function fold(value: string): string {
  return value.toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
}
