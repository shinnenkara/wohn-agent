export interface CitedText {
  text: string;
  citation: string;
}

export interface CitedVisit {
  when: string;
  place: string;
  citation: string;
}

export interface CitedPerson {
  name: string;
  role: string;
  citation: string;
}

export interface MailProposal {
  address: CitedText | null;
  visit: CitedVisit | null;
  contact: CitedPerson | null;
}

export function emptyProposal(): MailProposal {
  return { address: null, visit: null, contact: null };
}

export function validateCitation(body: string, input: MailProposal): { proposal: MailProposal; ok: boolean } {
  const proposal = emptyProposal();
  let kept = false;
  if (input.address && accept(body, input.address.text, input.address.citation) && !office(input.address.text)) {
    proposal.address = {
      text: input.address.text.trim(),
      citation: input.address.citation.trim(),
    };
    kept = true;
  }
  if (
    input.visit &&
    (input.visit.when.trim() !== "" || input.visit.place.trim() !== "") &&
    accept(body, `${input.visit.when} ${input.visit.place}`, input.visit.citation)
  ) {
    proposal.visit = {
      when: input.visit.when.trim(),
      place: input.visit.place.trim(),
      citation: input.visit.citation.trim(),
    };
    kept = true;
  }
  if (input.contact && input.contact.name.trim() !== "" && accept(body, input.contact.name, input.contact.citation)) {
    proposal.contact = {
      name: input.contact.name.trim(),
      role: input.contact.role.trim(),
      citation: input.contact.citation.trim(),
    };
    kept = true;
  }
  return { proposal, ok: kept };
}

function accept(body: string, value: string, citation: string): boolean {
  const quoted = citation.trim();
  if (quoted === "" || value.trim() === "") {
    return false;
  }
  return body.toLowerCase().includes(quoted.toLowerCase());
}

function office(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("invalidenstraße") || lower.includes("invalidenstrasse");
}
