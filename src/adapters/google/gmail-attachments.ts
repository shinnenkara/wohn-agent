import type { ListedAttachment, MailAttachmentSource } from "../../application/ports/mail-attachments.js";
import { authedGet, type Authorizer } from "./authed-get.js";
import { listPdfParts, type GmailMessageJson } from "./gmail-message.js";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailAttachmentSource implements MailAttachmentSource {
  constructor(
    private readonly authorizer: Authorizer,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async listPdfs(mailId: string): Promise<ListedAttachment[]> {
    const message = await this.message(mailId);
    return listPdfParts(message).map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType,
      attachmentId: part.attachmentId,
    }));
  }

  async download(mailId: string, attachmentId: string): Promise<Uint8Array> {
    if (attachmentId.startsWith("inline:")) {
      const part = listPdfParts(await this.message(mailId)).find((item) => item.attachmentId === attachmentId);
      if (!part?.data) {
        throw new Error("That PDF is no longer attached.");
      }
      return Buffer.from(part.data, "base64url");
    }
    const response = await authedGet<{ data?: string }>(
      this.authorizer,
      this.fetchImpl,
      `${GMAIL}/messages/${encodeURIComponent(mailId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!response.body?.data) {
      throw new Error("Gmail did not return the PDF.");
    }
    return Buffer.from(response.body.data, "base64url");
  }

  private async message(mailId: string): Promise<GmailMessageJson> {
    const response = await authedGet<GmailMessageJson>(
      this.authorizer,
      this.fetchImpl,
      `${GMAIL}/messages/${encodeURIComponent(mailId)}?format=full`,
      { allowStatus: [404] },
    );
    if (response.status === 404 || !response.body) {
      throw new Error("That mail is no longer in Gmail.");
    }
    return response.body;
  }
}
