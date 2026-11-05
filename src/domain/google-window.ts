const DAY_MS = 24 * 60 * 60 * 1000;

export const SYNC_WINDOW_DAYS = 14;

export function syncSince(now: Date, days = SYNC_WINDOW_DAYS): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function parseSinceFlag(argv: readonly string[]): Date | null {
  const inline = argv.find((arg) => arg.startsWith("--since="));
  const index = argv.indexOf("--since");
  if (inline && index !== -1) {
    throw new Error("--since needs a date, like 2026-10-01");
  }
  if (!inline && index === -1) {
    return null;
  }
  const raw = inline ? inline.slice("--since=".length) : argv[index + 1];
  if (!raw || raw.startsWith("-")) {
    throw new Error("--since needs a date, like 2026-10-01");
  }
  return parseSinceDate(raw);
}

export function formatDay(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseSinceDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("--since needs a date, like 2026-10-01");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("--since needs a date, like 2026-10-01");
  }
  return date;
}

export function gmailSearchQuery(since: Date, till: Date | null): string {
  const after = addUtcDays(utcDay(since), -1);
  let query = `after:${slashDate(after)} (from:immobilienscout24.de OR from:nachrichten.immobilienscout24.de)`;
  if (till) {
    const before = addUtcDays(utcDay(till), 1);
    query += ` before:${slashDate(before)}`;
  }
  return query;
}

export function calendarTimeMin(since: Date): string {
  return since.toISOString();
}

export function calendarTimeMax(till: Date): string {
  return addUtcDays(utcDay(till), 1).toISOString();
}

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(day: Date, amount: number): Date {
  return new Date(day.getTime() + amount * DAY_MS);
}

function slashDate(day: Date): string {
  const year = day.getUTCFullYear();
  const month = String(day.getUTCMonth() + 1).padStart(2, "0");
  const date = String(day.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${date}`;
}
