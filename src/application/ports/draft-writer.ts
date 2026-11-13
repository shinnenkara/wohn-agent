export interface ReplyAttachment {
  filename: string;
  content: Uint8Array;
}

export interface ReplyDraft {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string;
  references: string;
  attachment?: ReplyAttachment;
}

export interface DraftWriter {
  createReply(draft: ReplyDraft): Promise<{ messageId: string }>;
}
