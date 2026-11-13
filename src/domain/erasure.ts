import { buildGreeting } from "./message-template.js";
import { senderName } from "./mail-reply.js";
import { berlinParts } from "./timing.js";

export const ERASURE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function erasureDue(completedAt: Date): Date {
  return new Date(completedAt.getTime() + ERASURE_AFTER_DAYS * DAY_MS);
}

export function erasureLetter(input: { from: string; address: string; submittedAt: Date }): string {
  const place = input.address.trim() || "die Wohnung";
  const parts = berlinParts(input.submittedAt);
  const date = `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
  const paragraph = `bitte löschen Sie meine Bewerbungsunterlagen für ${place} nach Art. 17 DSGVO. Ich habe sie am ${date} übermittelt.`;
  return `${buildGreeting(senderName(input.from))}\n\n${paragraph}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
