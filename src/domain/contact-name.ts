const COMPANY = /\b(GmbH|AG|KG|OHG|UG|GbR|e\. ?K\.|Hausverwaltung)\b/;
const UI_CHROME = /telefonnummer|\banzeigen\b|\bnachricht\b/i;

export interface ContactCandidate {
  text: string;
  named: boolean;
  hasControls: boolean;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function selectContactName(candidates: readonly ContactCandidate[]): string | null {
  for (const candidate of candidates) {
    if (!candidate.named || candidate.hasControls) {
      continue;
    }
    const text = clean(candidate.text);
    if (text && text.length <= 80) {
      return text;
    }
  }

  let person = "";
  let company = "";
  for (const candidate of candidates) {
    if (candidate.named || candidate.hasControls) {
      continue;
    }
    const text = clean(candidate.text);
    if (!text || text.length > 80 || UI_CHROME.test(text)) {
      continue;
    }
    if (/^(Frau|Herr)\b/.test(text)) {
      if (!person || text.length < person.length) {
        person = text;
      }
    } else if (COMPANY.test(text) && (!company || text.length < company.length)) {
      company = text;
    }
  }
  return person || company || null;
}
