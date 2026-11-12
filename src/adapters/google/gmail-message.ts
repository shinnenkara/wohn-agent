import type { FetchedMail } from "../../application/ports/mailbox.js";

export interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
}

export interface GmailMessageJson {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function readGmailMessage(message: GmailMessageJson): FetchedMail {
  const text: string[] = [];
  const html: string[] = [];
  let calendarPart = false;
  walk(message.payload, text, html, (calendar) => {
    calendarPart = calendarPart || calendar;
  });
  const sentAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date(0).toISOString();
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    from: header(message.payload, "From"),
    replyTo: header(message.payload, "Reply-To"),
    messageId: header(message.payload, "Message-ID"),
    inReplyTo: header(message.payload, "In-Reply-To"),
    references: header(message.payload, "References"),
    subject: header(message.payload, "Subject"),
    sentAt,
    text: text.join("\n"),
    html: html.join("\n"),
    calendarPart,
  };
}

function walk(
  part: GmailPart | undefined,
  text: string[],
  html: string[],
  markCalendar: (value: boolean) => void,
): void {
  if (!part) {
    return;
  }
  const mime = (part.mimeType ?? "").toLowerCase();
  if (mime === "text/calendar") {
    markCalendar(true);
  }
  if (part.body?.data && mime === "text/plain") {
    text.push(decodeBase64Url(part.body.data));
  } else if (part.body?.data && mime === "text/html") {
    html.push(decodeBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) {
    walk(child, text, html, markCalendar);
  }
}

function header(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
