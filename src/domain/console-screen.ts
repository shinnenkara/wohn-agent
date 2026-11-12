import { countdownLabel, shortPriority, type QueueRow } from "./mail-action.js";

export type ConsoleEffect =
  | { kind: "none" }
  | { kind: "quit" }
  | { kind: "note"; message: string }
  | { kind: "open"; id: number; url: string }
  | { kind: "draft"; id: number }
  | { kind: "complete"; id: number }
  | { kind: "quarantine"; id: number; scoutId: string };

const HELP = "o open   d draft   c done   s scam   q quit";

export function commandsFrom(chunk: string): string[] {
  const commands: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    if (chunk.startsWith("\x1b[A", index) || chunk.startsWith("\x1bOA", index)) {
      commands.push("up");
      index += 3;
      continue;
    }
    if (chunk.startsWith("\x1b[B", index) || chunk.startsWith("\x1bOB", index)) {
      commands.push("down");
      index += 3;
      continue;
    }
    const char = chunk[index] ?? "";
    index += 1;
    if (char === "\x1b") {
      continue;
    }
    if (char === "\u0003") {
      commands.push("q");
      continue;
    }
    commands.push(char.toLowerCase());
  }
  return commands;
}

export function shouldBell(
  primed: boolean,
  seen: ReadonlySet<number>,
  rows: readonly { id: number; priority: string }[],
): boolean {
  if (!primed) {
    return false;
  }
  return rows.some((row) => row.priority === "P0_CRITICAL" && !seen.has(row.id));
}

export function effectFor(
  key: string,
  rows: readonly QueueRow[],
  selected: number,
): { selected: number; effect: ConsoleEffect } {
  if (key === "q") {
    return { selected: clamp(selected, rows.length), effect: { kind: "quit" } };
  }
  if (rows.length === 0) {
    return { selected: 0, effect: { kind: "none" } };
  }
  const index = clamp(selected, rows.length);
  if (key === "up") {
    return { selected: Math.max(0, index - 1), effect: { kind: "none" } };
  }
  if (key === "down") {
    return { selected: Math.min(rows.length - 1, index + 1), effect: { kind: "none" } };
  }
  const row = rows[index];
  if (!row) {
    return { selected: index, effect: { kind: "none" } };
  }
  if (key === "o") {
    if (row.actionUrl.trim() === "") {
      return { selected: index, effect: { kind: "note", message: "This action has no link." } };
    }
    return { selected: index, effect: { kind: "open", id: row.id, url: row.actionUrl } };
  }
  if (key === "d") {
    if (row.draftResponseText.trim() === "") {
      return { selected: index, effect: { kind: "note", message: "This action has no reply text." } };
    }
    return { selected: index, effect: { kind: "draft", id: row.id } };
  }
  if (key === "c") {
    return { selected: index, effect: { kind: "complete", id: row.id } };
  }
  if (key === "s") {
    return { selected: index, effect: { kind: "quarantine", id: row.id, scoutId: row.scoutId } };
  }
  return { selected: index, effect: { kind: "none" } };
}

export function renderConsole(input: {
  rows: readonly QueueRow[];
  selected: number;
  now: Date;
  notice: string;
}): string {
  const lines = [`${input.rows.length} open`, ""];
  if (input.rows.length === 0) {
    lines.push("No open actions.");
  }
  input.rows.forEach((row, index) => {
    const marker = index === input.selected ? ">" : " ";
    const badges = row.badges.length > 0 ? `  ${row.badges.join(" ")}` : "";
    lines.push(
      `${marker} ${pad(countdownLabel(row.deadlineAt, input.now), 5)} ${pad(shortPriority(row.priority), 3)} ${pad(row.title, 26)} ${pad(row.label, 28)} ${pad(row.status, 12)}${badges}`,
    );
  });
  lines.push("", HELP);
  if (input.notice.trim() !== "") {
    lines.push("", input.notice.trim());
  }
  return `${lines.join("\n")}\n`;
}

function clamp(selected: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.min(Math.max(selected, 0), length - 1);
}

function pad(value: string, width: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= width) {
    return clean.padEnd(width);
  }
  return `${clean.slice(0, width - 1)}…`;
}
