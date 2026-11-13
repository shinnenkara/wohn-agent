import { matchAddress, type MailCandidate } from "./mail-link.js";
import type { MailKind } from "./scout-mail.js";
import { fromScout } from "./scout-mail.js";

export function sameAccount(from: string, accountEmail: string | null): boolean {
  const account = (accountEmail ?? "").trim().toLowerCase();
  if (account === "") {
    return false;
  }
  return senderEmail(from) === account;
}

export function readingFirst(input: {
  from: string;
  kind: MailKind;
  scoutId: string;
  accountEmail: string | null;
  addressSignal: boolean;
}): boolean {
  if (input.scoutId !== "") {
    return true;
  }
  if (input.kind === "message_copy") {
    return true;
  }
  if (fromScout(input.from)) {
    return true;
  }
  if (sameAccount(input.from, input.accountEmail)) {
    return true;
  }
  return input.addressSignal;
}

export function rankForReading<T extends { from: string; kind: MailKind; scoutId: string; cleanText: string }>(
  items: readonly T[],
  input: { accountEmail: string | null; candidates: readonly MailCandidate[] },
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      first: readingFirst({
        from: item.from,
        kind: item.kind,
        scoutId: item.scoutId,
        accountEmail: input.accountEmail,
        addressSignal: matchAddress(item.cleanText, input.candidates) !== null,
      }),
    }))
    .sort((left, right) => Number(right.first) - Number(left.first) || left.index - right.index)
    .map((row) => row.item);
}

function senderEmail(from: string): string {
  const trimmed = from.trim().toLowerCase();
  const bracket = trimmed.match(/<([^>]+)>/);
  const raw = (bracket?.[1] ?? trimmed).trim();
  return raw.includes("@") ? raw : "";
}
