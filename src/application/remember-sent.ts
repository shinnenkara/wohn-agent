import { exposeUrl } from "../domain/expose-url.js";
import { Listing, type SentFacts } from "../domain/listing.js";
import type { ParsedMail } from "../domain/scout-mail.js";
import type { ListingRepository } from "./ports/listing-repository.js";

export function rememberSentApplication(
  listings: ListingRepository,
  parsed: ParsedMail,
  subject: string,
  body: string,
  at: Date,
): boolean {
  if (!sentConfirmation(parsed, subject, body)) {
    return false;
  }
  const facts = sentFacts(parsed);
  const current = listings.findById(parsed.exposeId);
  const next = current
    ? current.rememberSent(at, facts)
    : Listing.sentApplication({
        scoutId: parsed.exposeId,
        url: exposeUrl(parsed.exposeId),
        appliedAt: at,
        ...facts,
      });
  if (!next) {
    return false;
  }
  listings.save(next);
  return true;
}

function sentConfirmation(parsed: ParsedMail, subject: string, body: string): boolean {
  if (parsed.exposeId === "") {
    return false;
  }
  if (parsed.kind === "notice") {
    return true;
  }
  const text = `${subject}\n${body}`.toLowerCase();
  return text.includes("kontaktaufnahme wurde erfolgreich verschickt") || text.includes("persönliche vorstellung beim anbieter");
}

function sentFacts(parsed: ParsedMail): SentFacts {
  return {
    title: blank(parsed.title),
    address: blank(parsed.address),
    priceCold: amount(parsed.rent),
    rooms: amount(parsed.rooms),
    areaSqm: amount(parsed.size),
  };
}

function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function amount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
