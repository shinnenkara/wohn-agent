import { countdownLabel, shortPriority } from "../domain/mail-action.js";
import type { ConsoleSession, DraftVariant } from "./console-loop.js";

export interface TaskResponse {
  status: number;
  type: string;
  body: string;
}

export function listTasks(session: ConsoleSession): TaskResponse {
  const now = session.now();
  const tasks = session.queue(now).map((row) => ({
    id: row.id,
    priority: row.priority,
    otherBody: row.otherBody,
    declineBody: row.declineBody,
    declineLabel: row.declineLabel,
    shortPriority: shortPriority(row.priority),
    countdown: countdownLabel(row.deadlineAt, now),
    title: row.title,
    label: row.label,
    status: row.status,
    badges: row.badges,
    reason: row.reason,
  }));
  return json(tasks);
}

export async function runTask(session: ConsoleSession, action: string, id: number): Promise<TaskResponse> {
  if (action === "open") {
    return openTask(session, id);
  }
  if (action === "draft") {
    return draftTask(session, id, "accept");
  }
  if (action === "other") {
    return draftTask(session, id, "other");
  }
  if (action === "decline") {
    return declineTask(session, id);
  }
  if (action === "done") {
    return doneTask(session, id);
  }
  if (action === "scam") {
    return scamTask(session, id);
  }
  return text(404, "Not found");
}

function openTask(session: ConsoleSession, id: number): TaskResponse {
  const row = openRow(session, id);
  if (!row) {
    return text(404, "That action is no longer open.");
  }
  if (row.actionUrl.trim() === "") {
    return text(400, "This action has no link.");
  }
  session.setStatus(id, "IN_PROGRESS");
  return json({ url: row.actionUrl });
}

async function draftTask(session: ConsoleSession, id: number, variant: DraftVariant): Promise<TaskResponse> {
  try {
    const created = await session.createDraft(id, variant);
    session.setStatus(id, "IN_PROGRESS");
    return json({ url: created.url, notice: created.notice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return text(400, message);
  }
}

async function declineTask(session: ConsoleSession, id: number): Promise<TaskResponse> {
  try {
    const created = await session.createDraft(id, "decline");
    session.setStatus(id, "COMPLETED");
    return json({ url: created.url, notice: created.notice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the draft.";
    return text(400, message);
  }
}

function doneTask(session: ConsoleSession, id: number): TaskResponse {
  const row = openRow(session, id);
  if (!row) {
    return text(404, "That action is no longer open.");
  }
  session.setStatus(id, "COMPLETED");
  return json({ completed: true });
}

function scamTask(session: ConsoleSession, id: number): TaskResponse {
  const row = openRow(session, id);
  if (!row) {
    return text(404, "That action is no longer open.");
  }
  session.quarantine(row.id, row.scoutId);
  return json({ blocked: true });
}

function openRow(session: ConsoleSession, id: number) {
  return session.queue(session.now()).find((row) => row.id === id);
}

function json(body: unknown): TaskResponse {
  return { status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(body) };
}

function text(status: number, body: string): TaskResponse {
  return { status, type: "text/plain; charset=utf-8", body };
}
