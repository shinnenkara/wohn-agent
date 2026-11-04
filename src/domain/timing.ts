export interface RandomSource {
  next(): number;
}

export const systemRandom: RandomSource = {
  next: () => Math.random(),
};

export const WATCHDOG_INTERVAL_MS = 15_000;
export const SUBMIT_CONFIRMATION_TIMEOUT_MS = 5_000;
export const CACHED_SELECTOR_TIMEOUT_MS = 3_000;
export const SESSION_POLL_INTERVAL_MS = 15_000;

const ACTIVE_TIME_ZONE = "Europe/Berlin";

export interface BerlinParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function berlinParts(date: Date): BerlinParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ACTIVE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  const hour = Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

export function isWithinActiveHours(date: Date, startHour = 7, endHour = 23): boolean {
  const { hour } = berlinParts(date);
  return hour >= startHour && hour < endHour;
}

export function msUntilActiveWindow(date: Date, startHour = 7, endHour = 23): number {
  if (isWithinActiveHours(date, startHour, endHour)) {
    return 0;
  }
  const parts = berlinParts(date);
  const target = parts.hour >= endHour ? addCalendarDays(parts, 1) : parts;
  const instant = zonedDateTimeToUtc({
    ...target,
    hour: startHour,
    minute: 0,
    second: 0,
  });
  return Math.max(0, instant.getTime() - date.getTime());
}

export function pollIntervalMs(random: RandomSource, baseMs = 60_000): number {
  const jitter = -12_000 + random.next() * 30_000;
  return Math.round(baseMs + jitter);
}

export function betweenListingDelayMs(random: RandomSource): number {
  return Math.round(8_000 + random.next() * 12_000);
}

export function captchaCooldownMs(random: RandomSource): number {
  return Math.round(90_000 + random.next() * 30_000);
}

function addCalendarDays(parts: BerlinParts, days: number): BerlinParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function zonedDateTimeToUtc(parts: BerlinParts): Date {
  let utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = berlinParts(new Date(utc));
    const shownAsUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
    );
    const desiredAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const delta = desiredAsUtc - shownAsUtc;
    if (delta === 0) {
      break;
    }
    utc += delta;
  }
  return new Date(utc);
}
