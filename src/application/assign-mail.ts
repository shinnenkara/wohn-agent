import type { Clock } from "./ports/clock.js";
import type { MailStore } from "./ports/mail-store.js";
import type { ProgressLog } from "./ports/progress-log.js";
import type { LinkMethod } from "../domain/mail-link.js";
import type { FunnelStage } from "../domain/progress.js";
import type { MailKind } from "../domain/scout-mail.js";

export function stageForMail(kind: MailKind): FunnelStage | null {
  switch (kind) {
    case "notice":
      return "applied";
    case "message_copy":
    case "landlord":
      return "in_conversation";
    case "unclassified":
      return null;
  }
}

export function assignMail(
  deps: { mail: MailStore; progress: ProgressLog; clock: Clock },
  input: {
    gmailId: string;
    threadId: string;
    from: string;
    subject: string;
    kind: MailKind;
    scoutId: string;
    method: LinkMethod;
  },
): number {
  if (!deps.mail.linkMessage(input.gmailId, input.scoutId, input.method)) {
    return 0;
  }
  deps.mail.saveThread({
    threadId: input.threadId,
    subject: input.subject,
    from: input.from,
    scoutId: input.scoutId,
    linkMethod: input.method,
  });
  let moved = note(deps, input.scoutId, stageForMail(input.kind), input.gmailId);
  for (const extra of deps.mail.backfillThread(input.threadId, input.scoutId)) {
    moved += note(deps, input.scoutId, stageForMail(extra.kind), extra.gmailId);
  }
  return moved;
}

function note(
  deps: { progress: ProgressLog; clock: Clock },
  scoutId: string,
  stage: FunnelStage | null,
  evidenceId: string,
): number {
  if (!stage) {
    return 0;
  }
  const moved = deps.progress.note({
    scoutId,
    next: stage,
    source: "mail",
    evidenceId,
    at: deps.clock.now(),
  });
  return moved ? 1 : 0;
}
