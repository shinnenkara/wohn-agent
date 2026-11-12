import { z } from "zod";
import type { Authorizer } from "./authed-get.js";
import type { DraftWriter, ReplyDraft } from "../../application/ports/draft-writer.js";
import { replySubject } from "../../domain/mail-reply.js";

const GMAIL_DRAFTS = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

const DraftResponseSchema = z.object({
  message: z.object({ id: z.string().min(1) }).optional(),
});

export class GmailDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailDraftError";
  }
}

export class GmailDraftWriter implements DraftWriter {
  constructor(
    private readonly authorizer: Authorizer,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async createReply(draft: ReplyDraft): Promise<{ messageId: string }> {
    const payload = JSON.stringify({
      message: { raw: encodeReplyMime(draft), threadId: draft.threadId },
    });
    let response = await this.post(payload, false);
    if (response.status === 401) {
      response = await this.post(payload, true);
    }
    if (response.status === 403) {
      throw new GmailDraftError("Gmail refused the draft. Run npm run login.");
    }
    if (!response.ok) {
      throw new GmailDraftError(`gmail draft failed with ${response.status}`);
    }
    const parsed = DraftResponseSchema.safeParse(await readJson(response));
    const messageId = parsed.success ? parsed.data.message?.id : undefined;
    if (!messageId) {
      throw new GmailDraftError("gmail did not return a draft");
    }
    return { messageId };
  }

  private async post(payload: string, force: boolean): Promise<Response> {
    const token = await this.authorizer.accessToken(force);
    return this.fetchImpl(GMAIL_DRAFTS, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payload,
    });
  }
}

export function encodeReplyMime(draft: ReplyDraft): string {
  const headers = [
    `To: ${draft.to}`,
    `Subject: ${headerValue(replySubject(draft.subject))}`,
    draft.inReplyTo.trim() ? `In-Reply-To: ${draft.inReplyTo.trim()}` : "",
    draft.references.trim() ? `References: ${draft.references.trim()}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ].filter((line) => line !== "");
  const body = Buffer.from(draft.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}

function headerValue(value: string): string {
  if (/^[\u0020-\u007e]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}
