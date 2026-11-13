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
  ].filter((line) => line !== "");
  const raw = draft.attachment ? mixedMessage(headers, draft.body, draft.attachment) : plainMessage(headers, draft.body);
  return Buffer.from(raw, "utf8").toString("base64url");
}

function plainMessage(headers: readonly string[], body: string): string {
  return [...headers, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", wrapBase64(bodyBytes(body))].join(
    "\r\n",
  );
}

function mixedMessage(headers: readonly string[], body: string, attachment: NonNullable<ReplyDraft["attachment"]>): string {
  const boundary = `wohn_${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const filename = attachment.filename.replace(/[\r\n"]/g, "");
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(bodyBytes(body)),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${asciiFilename(filename)}"`,
    contentDisposition(filename),
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(attachment.content).toString("base64")),
    `--${boundary}--`,
  ].join("\r\n");
}

function bodyBytes(body: string): string {
  return Buffer.from(body, "utf8").toString("base64");
}

function wrapBase64(value: string): string {
  return value.replace(/(.{76})/g, "$1\r\n");
}

function asciiFilename(filename: string): string {
  return filename
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^\w.\-]+/g, "_");
}

function contentDisposition(filename: string): string {
  return `Content-Disposition: attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
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
