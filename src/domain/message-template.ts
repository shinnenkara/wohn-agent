const TITLES = /^(dr\.?|prof\.?|dipl\.-ing\.?|dipl\.\s*ing\.?|ing\.?|mag\.?|med\.?)$/i;
const LEGAL = /^(gmbh|ag|kg|ohg|ug|gbr|mbh|co\.?|e\.?k\.?|&|und)$/i;
const COMPANY =
  /\b(GmbH|AG|KG|OHG|UG|GbR|e\. ?K\.|Hausverwaltung|Immobilien)\b|^(ihr|ihre|unser|unsere)\b|teams?\b|vermietung/i;

function clean(text: string | null | undefined): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function lastName(rest: string): string {
  const parts = clean(rest)
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !TITLES.test(part))
    .filter((part) => !LEGAL.test(part));
  return parts[parts.length - 1] ?? "";
}

function hasTrailingSeparator(text: string): boolean {
  return /(?:^|\s)[-–—]+$/.test(text);
}

function stripTrailingSeparator(text: string): string {
  return text.replace(/(?:\s*[-–—]+)+$/, "").trim();
}

export function buildGreeting(rawName: string | null | undefined): string {
  const text = clean(rawName);
  if (!text) {
    return "Guten Tag,";
  }
  const person = text.match(/^(Frau|Herr)\b\s*(.*)$/i);
  if (!person) {
    if (COMPANY.test(text)) {
      return "Sehr geehrte Damen und Herren,";
    }
    return "Guten Tag,";
  }
  const rest = clean(person[2]);
  if (COMPANY.test(rest)) {
    return "Sehr geehrte Damen und Herren,";
  }
  const name = hasTrailingSeparator(rest) ? stripTrailingSeparator(rest) : lastName(rest);
  if (!name) {
    return "Guten Tag,";
  }
  if (person[1]?.toLowerCase() === "frau") {
    return `Sehr geehrte Frau ${name},`;
  }
  return `Sehr geehrter Herr ${name},`;
}

export function renderMessage(template: string, contactName: string | null, title: string): string {
  const greeting = buildGreeting(contactName);
  const body = template.replaceAll("{{title}}", title).trim();
  return body ? `${greeting}\n\n${body}` : greeting;
}
