import type { DraftWriter } from "../application/ports/draft-writer.js";
import type { MailStore } from "../application/ports/mail-store.js";
import type { Clock } from "../application/ports/clock.js";
import {
  commandsFrom,
  effectFor,
  renderConsole,
  shouldBell,
  type ConsoleEffect,
} from "../domain/console-screen.js";
import { gmailDraftUrl } from "../domain/gmail-url.js";
import { sortQueue, toQueueRow, type QueueRow } from "../domain/mail-action.js";
import { mailboxAddress } from "../domain/mail-reply.js";

const POLL_MS = 1000;

export interface ConsoleSession {
  queue(now: Date): QueueRow[];
  open(url: string): void;
  setStatus(id: number, status: "IN_PROGRESS" | "COMPLETED"): void;
  quarantine(id: number, scoutId: string): void;
  createDraft(id: number): Promise<string>;
  now(): Date;
}

export interface ConsoleIo {
  write(frame: string): void;
  bell(): void;
  nextKey(timeoutMs: number): Promise<string | null>;
}

export function createConsoleSession(input: {
  mail: MailStore;
  drafts: DraftWriter;
  clock: Clock;
  open(url: string): void;
}): ConsoleSession {
  return {
    queue(now) {
      const busy = input.mail.busyIntervals();
      return sortQueue(input.mail.listOpenActions().map((row) => toQueueRow(row, busy, now)));
    },
    open: input.open,
    setStatus(id, status) {
      input.mail.setActionStatus(id, status);
    },
    quarantine(id, scoutId) {
      if (scoutId !== "") {
        input.mail.quarantineScout(scoutId, input.clock.now());
        input.mail.blockOpenActions(scoutId);
        return;
      }
      input.mail.setActionStatus(id, "BLOCKED_SCAM");
    },
    async createDraft(id) {
      const action = input.mail.listOpenActions().find((row) => row.id === id);
      if (!action) {
        throw new Error("That action is no longer open.");
      }
      if (action.draftResponseText.trim() === "") {
        throw new Error("This action has no reply text.");
      }
      const source = input.mail.replySource(action.mailId);
      if (!source) {
        throw new Error("That mail is no longer stored.");
      }
      const to = mailboxAddress(source.replyTo, source.from);
      if (!to) {
        throw new Error("This mail has no reply address.");
      }
      const messageId = source.messageId.trim();
      const created = await input.drafts.createReply({
        threadId: source.threadId,
        to,
        subject: source.subject,
        body: action.draftResponseText,
        inReplyTo: messageId || source.inReplyTo.trim(),
        references: replyReferences(source.references, messageId),
      });
      return gmailDraftUrl(created.messageId, source.email);
    },
    now: () => input.clock.now(),
  };
}

export async function performConsoleEffect(session: ConsoleSession, effect: ConsoleEffect): Promise<string> {
  if (effect.kind === "note") {
    return effect.message;
  }
  if (effect.kind === "none" || effect.kind === "quit") {
    return "";
  }
  if (effect.kind === "open") {
    session.open(effect.url);
    session.setStatus(effect.id, "IN_PROGRESS");
    return "";
  }
  if (effect.kind === "complete") {
    session.setStatus(effect.id, "COMPLETED");
    return "";
  }
  if (effect.kind === "quarantine") {
    session.quarantine(effect.id, effect.scoutId);
    return "";
  }
  try {
    const url = await session.createDraft(effect.id);
    session.open(url);
    session.setStatus(effect.id, "IN_PROGRESS");
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Could not create the draft.";
  }
}

export async function runConsoleLoop(session: ConsoleSession, io: ConsoleIo): Promise<void> {
  let primed = false;
  let seen = new Set<number>();
  let selectedId: number | null = null;
  let notice = "";
  for (;;) {
    const now = session.now();
    const rows = session.queue(now);
    if (shouldBell(primed, seen, rows)) {
      io.bell();
    }
    seen = new Set(rows.filter((row) => row.priority === "P0_CRITICAL").map((row) => row.id));
    primed = true;
    let selected = rows.findIndex((row) => row.id === selectedId);
    if (selected < 0) {
      selected = 0;
    }
    io.write(renderConsole({ rows, selected, now, notice }));
    const key = await io.nextKey(POLL_MS);
    if (!key) {
      continue;
    }
    const next = effectFor(key, rows, selected);
    selectedId = rows[next.selected]?.id ?? selectedId;
    if (next.effect.kind === "quit") {
      return;
    }
    notice = await performConsoleEffect(session, next.effect);
  }
}

export function stdinKeys(): { nextKey(timeoutMs: number): Promise<string | null>; close(): void } {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("The console needs a terminal. Open it in a local terminal and run npm run console.");
  }
  const queued: string[] = [];
  let waiting: ((key: string) => void) | null = null;
  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const key of commandsFrom(text)) {
      const resolve = waiting;
      if (resolve) {
        waiting = null;
        resolve(key);
      } else {
        queued.push(key);
      }
    }
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);
  return {
    nextKey(timeoutMs) {
      const pending = queued.shift();
      if (pending) {
        return Promise.resolve(pending);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting = null;
          resolve(null);
        }, timeoutMs);
        waiting = (key) => {
          clearTimeout(timer);
          resolve(key);
        };
      });
    },
    close() {
      stdin.off("data", onData);
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
    },
  };
}

function replyReferences(references: string, messageId: string): string {
  const parts = references.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  if (messageId !== "" && !parts.includes(messageId)) {
    parts.push(messageId);
  }
  return parts.join(" ");
}
