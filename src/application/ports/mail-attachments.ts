export interface ListedAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

export interface MailAttachmentSource {
  listPdfs(mailId: string): Promise<ListedAttachment[]>;
  download(mailId: string, attachmentId: string): Promise<Uint8Array>;
}
